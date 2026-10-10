import type {SQLiteDatabase} from 'expo-sqlite';
export type Scope={accountId:string;deviceId:string;chatId:string};
export type Job=Scope&{uploadId:string;messageId:string;encryptedUri:string;localSealedDescriptor:string;digest:string;byteLength:number;status:'QUEUED'|'UPLOADED'|'MESSAGE_QUEUED'|'FAILED'};
type Stored={upload_id:string;account_id:string;device_id:string;chat_id:string;message_id:string;encrypted_uri:string;local_sealed_descriptor:string;digest:string;byte_length:number;status:Job['status']};
const map=(r:Stored):Job=>({uploadId:r.upload_id,accountId:r.account_id,deviceId:r.device_id,chatId:r.chat_id,messageId:r.message_id,encryptedUri:r.encrypted_uri,localSealedDescriptor:r.local_sealed_descriptor,digest:r.digest,byteLength:r.byte_length,status:r.status});
export class SqliteMediaQueue {
 constructor(private db:SQLiteDatabase){}
 async put(j:Job){await this.db.runAsync('INSERT INTO chat_media_uploads_v1 VALUES(?,?,?,?,?,?,?,?,?,?)',j.uploadId,j.accountId,j.deviceId,j.chatId,j.messageId,j.encryptedUri,j.localSealedDescriptor,j.digest,j.byteLength,j.status);}
 async get(s:Scope,id:string){const r=await this.db.getFirstAsync<Stored>('SELECT * FROM chat_media_uploads_v1 WHERE upload_id=? AND account_id=? AND device_id=? AND chat_id=?',id,s.accountId,s.deviceId,s.chatId);return r?map(r):null;}
 async status(s:Scope,id:string,status:Job['status']){await this.db.runAsync('UPDATE chat_media_uploads_v1 SET status=? WHERE upload_id=? AND account_id=? AND device_id=? AND chat_id=?',status,id,s.accountId,s.deviceId,s.chatId);}
 async list(s:Scope){return(await this.db.getAllAsync<Stored>("SELECT * FROM chat_media_uploads_v1 WHERE account_id=? AND device_id=? AND chat_id=? AND status IN ('QUEUED','UPLOADED')",s.accountId,s.deviceId,s.chatId)).map(map);}
 async discard(s:Scope,id:string){await this.db.runAsync('DELETE FROM chat_media_uploads_v1 WHERE upload_id=? AND account_id=? AND device_id=? AND chat_id=?',id,s.accountId,s.deviceId,s.chatId);}
}
