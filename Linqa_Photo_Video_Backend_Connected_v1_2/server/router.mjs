import {MAX_BYTES} from './media-service.mjs';
export function mediaRouter({express,service,authenticate,requireBoundDevice,uploadRateLimit}) {
 const router=express.Router();
 const scope=async req=>({accountId:req.session.accountId,deviceId:await requireBoundDevice(req.session),chatId:req.params.id});
 const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){if(e.status)res.status(e.status).json({code:e.code});else next(e);}};
 router.put('/v1/chats/:id/media/:uploadId',authenticate,uploadRateLimit,
  express.raw({type:'application/octet-stream',limit:MAX_BYTES}),wrap(async(req,res)=>{
   const record=await service.upload(await scope(req),{uploadId:req.params.uploadId,digest:req.get('X-Ciphertext-SHA256'),bytes:req.body});
   res.status(200).json({uploadId:record.uploadId,digest:record.digest,byteLength:record.byteLength});
  }));
 router.get('/v1/chats/:id/media/:uploadId',authenticate,wrap(async(req,res)=>{
  const {record,bytes}=await service.download(await scope(req),req.params.uploadId);
  res.set({'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Ciphertext-SHA256':record.digest}).send(bytes);
 }));
 return router;
}
