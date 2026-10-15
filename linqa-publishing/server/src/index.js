import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import {randomUUID} from 'node:crypto';
import {S3Client,HeadObjectCommand,PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {pool} from './db.js';
import {requireAuth} from './auth.js';
import {eventInput,uploadInput,uuid} from './validation.js';
const app=express();app.disable('x-powered-by');app.use(helmet());
const origins=(process.env.CORS_ORIGINS||'').split(',').filter(Boolean);
app.use(cors({origin:(origin,cb)=>cb(null,!origin||origins.includes(origin))}));
app.use(express.json({limit:'64kb'}));
const s3=new S3Client({region:process.env.AWS_REGION});
const bucket=process.env.MEDIA_BUCKET;
if(!bucket) throw new Error('MEDIA_BUCKET required');
const error=(res,status,code)=>res.status(status).json({error:code});
app.get('/healthz',(_req,res)=>res.json({ok:true}));
app.use('/api/publishing',requireAuth);
app.post('/api/publishing/uploads',async(req,res,next)=>{
 try{
  const parsed=uploadInput.safeParse(req.body);if(!parsed.success)return error(res,400,'invalid_upload');
  const {mimeType,bytes}=parsed.data;const kind=mimeType.startsWith('image/')?'image':'video';
  if(bytes>(kind==='image'?10:100)*1024*1024)return error(res,400,'file_too_large');
  const id=randomUUID(),key=`publishing/${req.userId}/${id}`;
  const expires=new Date(Date.now()+15*60*1000);
  await pool.query('INSERT INTO publishing_uploads(id,owner_id,object_key,mime_type,bytes,kind,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,req.userId,key,mimeType,bytes,kind,expires]);
  const url=await getSignedUrl(s3,new PutObjectCommand({Bucket:bucket,Key:key,ContentType:mimeType}),{expiresIn:600});
  res.status(201).json({uploadId:id,url,method:'PUT',headers:{'Content-Type':mimeType},expiresAt:expires.toISOString()});
 }catch(e){next(e);}
});
app.post('/api/publishing/events',async(req,res,next)=>{
 const parsed=eventInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_event',details:parsed.error.flatten()});
 const key=req.header('Idempotency-Key');if(!uuid.safeParse(key).success)return error(res,400,'invalid_idempotency_key');
 const e=parsed.data;const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize requests sharing the same key, including simultaneous submissions.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${req.userId}:${key}`]);
  const existing=await client.query('SELECT event_id FROM publishing_idempotency WHERE owner_id=$1 AND idempotency_key=$2',[req.userId,key]);
  if(existing.rowCount){await client.query('COMMIT');return res.status(200).json({id:existing.rows[0].event_id,status:'published',replayed:true});}
  const uploadIds=[...new Set(e.uploadIds)];if(uploadIds.length!==e.uploadIds.length){await client.query('ROLLBACK');return error(res,400,'duplicate_upload_ids');}
  let uploads=[];
  if(uploadIds.length){
   const r=await client.query('SELECT * FROM publishing_uploads WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND consumed_event_id IS NULL AND expires_at>now() FOR UPDATE',[uploadIds,req.userId]);
   if(r.rowCount!==uploadIds.length){await client.query('ROLLBACK');return error(res,400,'invalid_upload_ids');}
   uploads=r.rows;
   for(const u of uploads){
    const head=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:u.object_key})).catch(()=>null);
    if(!head||Number(head.ContentLength)!==Number(u.bytes)||head.ContentType!==u.mime_type){await client.query('ROLLBACK');return error(res,409,'upload_not_verified');}
   }
  }
  const r=await client.query(`INSERT INTO publishing_events(creator_id,title,description,starts_at,ends_at,timezone,venue_name,latitude,longitude,visibility,status,feeling_activity)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'published',$11) RETURNING id,status`,[
    req.userId,e.title,e.description,e.startsAt,e.endsAt||null,e.timezone,e.location,e.coordinates?.latitude??null,e.coordinates?.longitude??null,e.visibility,e.feelingActivity||null]);
  const event=r.rows[0];
  for(const u of uploads){
   await client.query('INSERT INTO publishing_media(event_id,object_key,mime_type,bytes,kind) VALUES($1,$2,$3,$4,$5)',[event.id,u.object_key,u.mime_type,u.bytes,u.kind]);
   await client.query('UPDATE publishing_uploads SET consumed_event_id=$1 WHERE id=$2',[event.id,u.id]);
  }
  await client.query('INSERT INTO publishing_idempotency(owner_id,idempotency_key,event_id) VALUES($1,$2,$3)',[req.userId,key,event.id]);
  await client.query('COMMIT');res.status(201).json(event);
 }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e);}finally{client.release();}
});
app.get('/api/publishing/events/:id',async(req,res,next)=>{
 try{
  if(!uuid.safeParse(req.params.id).success)return error(res,400,'invalid_id');
  const r=await pool.query(`SELECT id,creator_id,title,description,starts_at,ends_at,timezone,venue_name,latitude,longitude,visibility,status,feeling_activity,created_at FROM publishing_events WHERE id=$1 AND (creator_id=$2 OR (visibility='public' AND status='published'))`,[req.params.id,req.userId]);
  if(!r.rowCount)return error(res,404,'not_found');res.json(r.rows[0]);
 }catch(e){next(e);}
});
app.get('/api/publishing/events',async(req,res,next)=>{
 try{
  const limit=Math.min(Math.max(Number(req.query.limit)||20,1),50);
  const r=await pool.query(`SELECT id,title,description,starts_at,venue_name,visibility,status FROM publishing_events WHERE creator_id=$1 OR (visibility='public' AND status='published') ORDER BY starts_at DESC,id DESC LIMIT $2`,[req.userId,limit]);res.json({events:r.rows});
 }catch(e){next(e);}
});
app.patch('/api/publishing/events/:id',async(req,res,next)=>{
 try{
  if(!uuid.safeParse(req.params.id).success)return error(res,400,'invalid_id');
  const parsed=eventInput.omit({uploadIds:true}).partial().safeParse(req.body);
  if(!parsed.success)return error(res,400,'invalid_event');
  const p=parsed.data;if(!Object.keys(p).length)return error(res,400,'empty_update');
  const names={title:'title',description:'description',startsAt:'starts_at',endsAt:'ends_at',timezone:'timezone',location:'venue_name',visibility:'visibility',feelingActivity:'feeling_activity'};
  const sets=[],values=[];
  for(const [key,column] of Object.entries(names))if(Object.hasOwn(p,key)){values.push(p[key]);sets.push(`${column}=$${values.length}`);}
  if(Object.hasOwn(p,'coordinates')){values.push(p.coordinates?.latitude??null);sets.push(`latitude=$${values.length}`);values.push(p.coordinates?.longitude??null);sets.push(`longitude=$${values.length}`);}
  values.push(req.params.id,req.userId);
  const r=await pool.query(`UPDATE publishing_events SET ${sets.join(',')},updated_at=now() WHERE id=$${values.length-1} AND creator_id=$${values.length} AND status='published' RETURNING id,status`,values);
  if(!r.rowCount)return error(res,404,'not_found');res.json(r.rows[0]);
 }catch(e){next(e);}
});
app.post('/api/publishing/events/:id/cancel',async(req,res,next)=>{
 try{if(!uuid.safeParse(req.params.id).success)return error(res,400,'invalid_id');
 const r=await pool.query("UPDATE publishing_events SET status='cancelled',updated_at=now() WHERE id=$1 AND creator_id=$2 AND status='published' RETURNING id,status",[req.params.id,req.userId]);
 if(!r.rowCount)return error(res,404,'not_found');res.json(r.rows[0]);}catch(e){next(e);}
});
app.use((err,_req,res,_next)=>{console.error('publishing_api_error',err);res.status(500).json({error:'internal_error'});});
const port=Number(process.env.PORT||3005);app.listen(port,()=>console.log(`Linqa Publishing API listening on ${port}`));
