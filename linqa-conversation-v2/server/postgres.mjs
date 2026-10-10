import {randomUUID} from 'node:crypto';
export function createPostgresRepository(pool) {
 async function transaction(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
  catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
 }
 return {
  async members(id) { const r=await pool.query('SELECT user_id FROM lc2_members WHERE conversation_id=$1',[id]); return r.rows.map(x=>x.user_id); },
  open(pair,members) { return transaction(async c=>{
   const r = await c.query('INSERT INTO lc2_conversations(id,pair_key) VALUES($1,$2) ON CONFLICT(pair_key) DO UPDATE SET pair_key=excluded.pair_key RETURNING id',[randomUUID(),pair]);
   const id=r.rows[0].id;
   for (const user of members) await c.query('INSERT INTO lc2_members VALUES($1,$2) ON CONFLICT DO NOTHING',[id,user]);
   return {id};
  }); },
  async list(user) {
   const r = await pool.query(`SELECT c.id,c.created_at,
    (SELECT m.user_id FROM lc2_members m WHERE m.conversation_id=c.id AND m.user_id<>$1 LIMIT 1) AS peer_id
    FROM lc2_conversations c JOIN lc2_members own ON own.conversation_id=c.id AND own.user_id=$1
    ORDER BY c.created_at DESC LIMIT 100`,[user]);
   return r.rows;
  },
  async history(id,actor,after) {
   const r = await pool.query(`SELECT e.seq::text,e.id,e.client_id,e.sender_id,e.created_at,x.ciphertext
    FROM lc2_events e JOIN lc2_envelopes x ON x.event_id=e.id
    WHERE e.conversation_id=$1 AND e.seq>$2::bigint AND x.user_id=$3 AND x.device_id=$4
    ORDER BY e.seq ASC LIMIT 100`,[id,after,actor.userId,actor.deviceId]);
   return {events:r.rows,cursor:r.rows.at(-1)?.seq ?? after,hasMore:r.rows.length===100};
  },
  append(id,actor,input,eventId) { return transaction(async c=>{
   const r = await c.query(`INSERT INTO lc2_events(id,conversation_id,sender_id,client_id) VALUES($1,$2,$3,$4)
    ON CONFLICT(conversation_id,sender_id,client_id) DO NOTHING RETURNING id,seq::text`,[eventId,id,actor.userId,input.clientId]);
   if (!r.rows.length) {
    const existing=await c.query('SELECT id,seq::text FROM lc2_events WHERE conversation_id=$1 AND sender_id=$2 AND client_id=$3',[id,actor.userId,input.clientId]);
    return {...existing.rows[0],duplicate:true};
   }
   for (const e of input.envelopes) await c.query('INSERT INTO lc2_envelopes VALUES($1,$2,$3,$4)',[eventId,e.userId,e.deviceId,e.ciphertext]);
   return {...r.rows[0],duplicate:false};
  }); }
 };
}
