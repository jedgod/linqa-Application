const map=r=>r&&({uploadId:r.upload_id,accountId:r.account_id,deviceId:r.device_id,chatId:r.chat_id,digest:r.digest,byteLength:Number(r.byte_length)});
export class PostgresMediaRepository {
 constructor(pool,{reserveQuotaAndVerifyMembership}){this.pool=pool;this.reserve=reserveQuotaAndVerifyMembership;}
 async get(id){return map((await this.pool.query('SELECT * FROM chat_media_uploads_v1 WHERE upload_id=$1',[id])).rows[0]);}
 async insertReady(r){const client=await this.pool.connect();try{
  await client.query('BEGIN');
  // Serializes the same upload ID across accounts to keep quota idempotent.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[r.uploadId]);
  const existing=map((await client.query('SELECT * FROM chat_media_uploads_v1 WHERE upload_id=$1',[r.uploadId])).rows[0]);
  if(existing){await client.query('COMMIT');return existing;}
  // REQUIRED: recheck membership/device in this transaction and reserve bytes
  // under an account quota lock. Must throw on revoked/banned/over-limit account.
  await this.reserve(client,r);
  const result=await client.query('INSERT INTO chat_media_uploads_v1(upload_id,account_id,device_id,chat_id,digest,byte_length) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[r.uploadId,r.accountId,r.deviceId,r.chatId,r.digest,r.byteLength]);
  await client.query('COMMIT');return map(result.rows[0]);
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
}
