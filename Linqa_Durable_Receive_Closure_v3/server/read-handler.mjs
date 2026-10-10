/** Mount inside existing authenticated relay router. Dependencies map existing schema. */
export function readHandler({db,requireSession,requireBoundDevice,findReadableMessageIds}) {
 return async(req,res,next)=>{
  try{
   const session=await requireSession(req); // NEVER trust body account/device
   const deviceId=await requireBoundDevice(session);
   const conversationId=req.params.conversationId;
   const ids=req.body?.messageIds;
   if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>200))return res.status(400).json({code:'INVALID_MESSAGE_IDS'});
   const unique=[...new Set(ids)];
   await db.transaction(async tx=>{
    // Query must enforce membership, message visibility, incoming messages and
    // soft-delete rules IN THIS TRANSACTION; lock membership against revocation.
    const allowed=await findReadableMessageIds(tx,{accountId:session.accountId,deviceId,conversationId,ids:unique});
    const set=new Set(allowed);
    if(unique.some(id=>!set.has(id)))throw Object.assign(new Error('NOT_AUTHORIZED'),{status:403});
    for(const id of unique)await tx.query(`INSERT INTO chat_message_reads_v3(account_id,conversation_id,message_id,device_id)
     VALUES($1,$2,$3,$4) ON CONFLICT(account_id,conversation_id,message_id) DO NOTHING`,[session.accountId,conversationId,id,deviceId]);
    // Wire existing transactional outbox here if recipients need pushed updates.
   });
   res.status(204).end();
  }catch(error){if(error.status===403)return res.status(403).json({code:'NOT_AUTHORIZED'});next(error);}
 };
}
