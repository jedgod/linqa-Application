import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import type {EventPayload} from '../../components/publishing/LinqaCreateEvent';

export type PublishingConfig={baseUrl:string;getAccessToken:()=>Promise<string>};
export type DraftState='draft'|'pending'|'published'|'needs_attention';
export type LocalEvent={id:string;payload:EventPayload;timezone:string;status:DraftState;remoteId:string|null;lastError:string|null};
let database:Promise<SQLite.SQLiteDatabase>|undefined;
async function db(){
 if(!database)database=(async()=>{
  const d=await SQLite.openDatabaseAsync('linqa_publishing.db');
  await d.execAsync(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS publishing_outbox(
    id TEXT PRIMARY KEY,payload TEXT NOT NULL,timezone TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','pending','published','needs_attention')),
    remote_id TEXT,last_error TEXT,updated_at TEXT NOT NULL
   );`);return d;
 })();return database;
}
export async function saveDraft(payload:EventPayload,timezone:string,id=Crypto.randomUUID(),status:DraftState='draft'){
 const d=await db();await d.runAsync(`INSERT INTO publishing_outbox(id,payload,timezone,status,remote_id,last_error,updated_at)
 VALUES(?,?,?,?,NULL,NULL,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,timezone=excluded.timezone,status=excluded.status,updated_at=excluded.updated_at`,
 id,JSON.stringify(payload),timezone,status,new Date().toISOString());return id;
}
export async function listLocalEvents():Promise<LocalEvent[]>{
 const d=await db();const rows=await d.getAllAsync<{id:string;payload:string;timezone:string;status:DraftState;remote_id:string|null;last_error:string|null}>('SELECT * FROM publishing_outbox ORDER BY updated_at DESC');
 return rows.map(r=>({id:r.id,payload:JSON.parse(r.payload),timezone:r.timezone,status:r.status,remoteId:r.remote_id,lastError:r.last_error}));
}
export async function markPending(id:string){const d=await db();await d.runAsync("UPDATE publishing_outbox SET status='pending',last_error=NULL,updated_at=? WHERE id=?",new Date().toISOString(),id);}
async function request(config:PublishingConfig,path:string,method:string,body?:unknown,key?:string){
 const token=await config.getAccessToken();if(!token)throw new Error('Authentication required');
 const res=await fetch(config.baseUrl.replace(/\/$/,'')+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await res.json().catch(()=>({}));if(!res.ok)throw Object.assign(new Error(json.error||`HTTP ${res.status}`),{status:res.status});return json;
}
async function upload(config:PublishingConfig,asset:EventPayload['attachments'][number]){
 const info=await FileSystem.getInfoAsync(asset.uri);
 if(!info.exists||!('size' in info)||!info.size)throw new Error('Attachment not found');
 const mime=asset.mimeType||(asset.type==='video'?'video/mp4':'image/jpeg');
 const signed=await request(config,'/api/publishing/uploads','POST',{mimeType:mime,bytes:info.size});
 // Native file upload avoids loading large videos into JavaScript memory.
 // The server answers with a path on its own address; the phone resolves it the same way it resolves every API call.
 const address=String(signed.url).startsWith('/')?config.baseUrl.replace(/\/$/,'')+signed.url:signed.url;
 const result=await FileSystem.uploadAsync(address,asset.uri,{httpMethod:'PUT',uploadType:FileSystem.FileSystemUploadType.BINARY_CONTENT,headers:signed.headers});
 if(result.status<200||result.status>=300)throw new Error(`Media upload failed (${result.status})`);
 return signed.uploadId as string;
}
// Single flight (as the pack's README asks): a second caller waits for the run in progress instead of uploading the same
// pending item again at the same time, which left an unused upload behind.
let running:Promise<unknown>|undefined;
export function syncPublishingOutbox(config:PublishingConfig):ReturnType<typeof syncOnce>{
 const next=(running??Promise.resolve()).catch(()=>undefined).then(()=>syncOnce(config));
 running=next;void next.finally(()=>{if(running===next)running=undefined;}).catch(()=>undefined);return next;
}
async function syncOnce(config:PublishingConfig){
 const d=await db();const rows=(await listLocalEvents()).filter(r=>r.status==='pending');
 const results:{id:string;status:'published'|'pending'|'needs_attention';error?:string}[]=[];
 for(const row of rows){
  try{
   const uploadIds=[] as string[];
   for(const attachment of row.payload.attachments)uploadIds.push(await upload(config,attachment));
   const payload={title:row.payload.title,startsAt:row.payload.startsAt,location:row.payload.location,
    coordinates:row.payload.coordinates,description:row.payload.description,timezone:row.timezone,
    visibility:'public',uploadIds};
   const result=await request(config,'/api/publishing/events','POST',payload,row.id);
   await d.runAsync("UPDATE publishing_outbox SET status='published',remote_id=?,last_error=NULL,updated_at=? WHERE id=?",result.id,new Date().toISOString(),row.id);
   results.push({id:row.id,status:'published'});
  }catch(e){
   const error=e instanceof Error?e.message:String(e);
   const http=(e as {status?:number}).status;
   const status=http&&http>=400&&http<500&&http!==408&&http!==429?'needs_attention':'pending';
   await d.runAsync('UPDATE publishing_outbox SET status=?,last_error=?,updated_at=? WHERE id=?',status,error,new Date().toISOString(),row.id);
   results.push({id:row.id,status,error});
  }
 }
 return results;
}
export async function publishOrQueue(config:PublishingConfig,payload:EventPayload,timezone:string){
 const id=await saveDraft(payload,timezone,undefined,'pending');
 const results=await syncPublishingOutbox(config);
 const result=results.find(x=>x.id===id);
 if(result)return {localId:id,status:result.status,error:result.error};
 // Another run (the background sync) may already have handled it: report what the outbox says, not a guess.
 const row=(await listLocalEvents()).find(x=>x.id===id);
 return {localId:id,status:(row?.status==='published'||row?.status==='needs_attention')?row.status:'pending' as const,error:row?.lastError??undefined};
}
