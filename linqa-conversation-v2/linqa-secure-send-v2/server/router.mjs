import {createChatService, requireValue, isUuid} from './service.mjs';
import {createPostgresRepository} from './postgres.mjs';
// Express passed by host; no second auth system or permissive dev fallback.
export function createConversationRouter({express,pool,authenticate,policy,devices,rateLimit,authorizeMutation,authorizeAppend}) {
 for (const [name,value] of Object.entries({authenticate,rateLimit,authorizeMutation,authorizeAppend})) if(typeof value!=='function') throw new Error(`Missing ${name} adapter`);
 if(typeof policy?.canChat!=='function' || typeof devices?.listForUsers!=='function' || typeof devices?.isActive!=='function') throw new Error('Missing policy/device adapters');
 const router=express.Router(); const service=createChatService({repo:createPostgresRepository(pool,authorizeAppend),policy,devices});
 const route=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 router.use(authenticate,rateLimit,express.json({limit:'2mb'}));
 router.use((req,res,next)=>Promise.resolve().then(async()=>{
  requireValue(isUuid(req.actor?.userId) && typeof req.actor?.deviceId==='string',401,'Authentication required');
  requireValue(await devices.isActive(req.actor.userId,req.actor.deviceId),401,'Device inactive');
 }).then(()=>next(),next));
 router.get('/',route(async(req,res)=>res.json({conversations:await service.list(req.actor)})));
 router.post('/direct',authorizeMutation,route(async(req,res)=>res.json(await service.open(req.actor,req.body?.peerId))));
 router.get('/:id/events',route(async(req,res)=>res.json(await service.history(req.actor,req.params.id,req.query.after??'0'))));
 router.post('/:id/events',authorizeMutation,route(async(req,res)=>res.status(202).json(await service.send(req.actor,req.params.id,req.body))));
 router.use((error,req,res,next)=>{
  // Do not log request bodies, ciphertext, keys or session tokens.
  res.status(error.status ?? 500).json({error:error.status?error.message:'Conversation service unavailable'});
 });
 return router;
}
