import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { requireScope } from "../auth/jwt.js";
import { createActiveAuthenticator } from "../auth/active-principal.js";
import { createSocketSessionGuard } from "../realtime/session-guard.js";
import { createAuthorizedSender } from "../realtime/authorized-sender.js";
import { CallsStore } from "./calls.store.js";
import { CallsService, CallError } from "./calls.service.js";
import { TurnService } from "./turn.service.js";
import { NoopRingNotifier, type AuthContext, type CallEmitter } from "./calls.ports.js";
import { C2S, type DeviceInfo } from "./calls.protocol.js";
import { ReportsService } from "./reports.service.js";
import { hydrate, RoomPersistence, SqlReportsRepository } from "./persistence.js";

const uuid=z.string().uuid();
const room=z.object({callId:uuid}).strict();
const envelope=z.object({userId:uuid,deviceId:uuid,envelope:z.string().min(1).max(8192).regex(/^[A-Za-z0-9+/=_-]+$/)}).strict();
const schemas: Record<string,z.ZodTypeAny> = {
  [C2S.create]:z.object({conversationId:uuid,kind:z.enum(['voice','video']),keyId:z.string().min(1).max(64),inviteeUserIds:z.array(uuid).min(1).max(7),keyEnvelopes:z.array(envelope).max(64)}).strict(),
  [C2S.join]:room,[C2S.leave]:room,[C2S.decline]:room,
  [C2S.signal]:z.object({callId:uuid,to:z.string().regex(/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i),ciphertext:z.string().min(1).max(65536)}).strict(),
  [C2S.invite]:z.object({callId:uuid,userIds:z.array(uuid).min(1).max(7),keyEnvelopes:z.array(envelope).max(64)}).strict(),
  [C2S.devices]:z.object({}).strict(),
  [C2S.handoffOffer]:z.object({callId:uuid,toDeviceId:uuid,keyEnvelope:z.string().min(1).max(8192),transferState:z.object({muted:z.boolean(),cameraOn:z.boolean()}).strict()}).strict(),
  [C2S.handoffAccept]:z.object({callId:uuid,token:z.string().min(16).max(128)}).strict(),
  [C2S.handoffCancel]:z.object({callId:uuid,token:z.string().min(16).max(128)}).strict()
};
class Emitter implements CallEmitter {
  private readonly senders=new WeakMap<WebSocket,(message:string)=>void>();
  register(socket:WebSocket,ctx:AuthContext,send:(message:string)=>void){this.connections.set(socket,ctx);this.senders.set(socket,send);}
  connections=new Map<WebSocket,AuthContext>();
  pending: (()=>void)[]=[];
  private send(socket: WebSocket,event:string,data:unknown) { this.senders.get(socket)?.(JSON.stringify({event,data})); }
  toUser(userId:string,event:string,data:unknown,opts?:{exceptDeviceId?:string}) { this.pending.push(()=>{for(const [s,c] of this.connections) if(c.userId===userId && c.deviceId!==opts?.exceptDeviceId) this.send(s,event,data);}); }
  toDevice(userId:string,deviceId:string,event:string,data:unknown) { this.pending.push(()=>{for(const [s,c] of this.connections) if(c.userId===userId && c.deviceId===deviceId) this.send(s,event,data);}); }
  onlineDevices(userId:string):DeviceInfo[] { return [...new Map([...this.connections.values()].filter(c=>c.userId===userId).map(c=>[c.deviceId,{deviceId:c.deviceId,name:c.deviceName,platform:c.platform}])).values()]; }
  flush() { const queue=this.pending.splice(0);queue.forEach(fn=>fn()); }
}
/** One active call-room worker per DB. Fail fast instead of advertising unsafe Redis scalability. */
export async function registerCallRooms(app:FastifyInstance,config:AppConfig,db:Database) {
  const available=await db.query(`SELECT to_regclass('public.secure_call_rooms') AS name`);
  if(!available.rows[0]?.name) { app.log.warn('Secure call rooms require migration 065'); return; }
  const lease=await db.connect();
  const lock=await lease.query(`SELECT pg_try_advisory_lock(hashtext('linqa-secure-call-room-worker')) AS acquired`);
  if(!lock.rows[0]?.acquired) { lease.release(); app.log.warn('Secure call-room worker already running'); return; }
  const store=new CallsStore();const emitter=new Emitter();const turn=new TurnService(config);const persistence=new RoomPersistence(db);
  const saved=await db.query(`SELECT state FROM secure_call_rooms WHERE updated_at > now()-interval '7 days'`);
  for(const row of saved.rows) { const call=hydrate(row.state); if(!call.endedAt) { call.endedAt=Date.now();call.endReason='error';call.invited.clear(); } store.put(call); }
  await persistence.save(store.all());
  const conversations={
    async isMember(conversationId:string,userId:string) { return !!(await db.query(`SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND removed_at IS NULL`,[conversationId,userId])).rowCount; },
    async canCall(from:string,to:string) { return from!==to && !!(await db.query(`SELECT 1 FROM conversation_members a JOIN conversation_members b ON a.conversation_id=b.conversation_id WHERE a.user_id=$1 AND b.user_id=$2 AND a.removed_at IS NULL AND b.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM blocked_users WHERE (blocker_user_id=$1 AND blocked_user_id=$2) OR (blocker_user_id=$2 AND blocked_user_id=$1)) LIMIT 1`,[from,to])).rowCount; }
  };
  const calls=new CallsService(store,turn,emitter,conversations,new NoopRingNotifier());
  const reports=new ReportsService(calls,new SqlReportsRepository(db));
  let queue=Promise.resolve(); let stopped=false;
  function serialize<T>(fn:()=>Promise<T>|T):Promise<T> {
    const operation=queue.then(async()=>{ if(stopped) throw new Error('rooms-unavailable');const result=await fn();await persistence.save(store.all());emitter.flush();return result; });
    queue=operation.then(()=>undefined,()=>undefined);return operation;
  }
  const interval=setInterval(()=>{ if(!stopped) void serialize(()=>undefined).catch(error=>{ app.log.error({err:error},'Secure call-room persistence failed'); stopped=true;for(const socket of emitter.connections.keys()) socket.close(1011,'persistence unavailable'); }); },1000);interval.unref();
  app.addHook('onClose',async()=>{clearInterval(interval);calls.onModuleDestroy();await queue;await persistence.save(store.all());await lease.query(`SELECT pg_advisory_unlock(hashtext('linqa-secure-call-room-worker'))`);lease.release();});
  const authenticate=createActiveAuthenticator(config,db);
  async function auth(request:FastifyRequest,scope:string):Promise<AuthContext> {
    const principal=await authenticate(request);requireScope(principal,scope);
    if(!principal.deviceId) throw new Error('device-bound-token-required');
    const device=(await db.query(`SELECT device_name,platform FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL`,[principal.deviceId,principal.userId])).rows[0];
    if(!device) throw new Error('inactive-device');
    return {userId:principal.userId,deviceId:principal.deviceId,deviceName:device.device_name,platform:String(device.platform).toLowerCase() as AuthContext['platform']};
  }
  async function checkEnvelopes(envelopes:Array<{userId:string;deviceId:string}>) {
    for(const e of envelopes) if(!(await db.query(`SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE' AND revoked_at IS NULL`,[e.deviceId,e.userId])).rowCount) throw new CallError('inactive-invitee-device');
  }
  async function dispatch(ctx:AuthContext,event:string,raw:unknown) {
    const schema=schemas[event];if(!schema) throw new CallError('unknown-event');const b:any=schema.parse(raw);
    if(event===C2S.create) { if(store.activeCallsForDevice(ctx.userId,ctx.deviceId).length) throw new CallError('call-already-active');await checkEnvelopes(b.keyEnvelopes);turn.iceServersFor(ctx.userId);return calls.create(ctx,b); }
    if(event===C2S.join) return calls.join(ctx,b.callId);
    if(event===C2S.leave) return calls.leave(ctx,b.callId);
    if(event===C2S.decline) return calls.decline(ctx,b.callId);
    if(event===C2S.signal) return calls.signal(ctx,b);
    if(event===C2S.invite) {await checkEnvelopes(b.keyEnvelopes);return calls.invite(ctx,b.callId,b.userIds,b.keyEnvelopes);}
    if(event===C2S.devices) return calls.otherDevices(ctx);
    if(event===C2S.handoffOffer) return calls.handoffOffer(ctx,b);
    if(event===C2S.handoffAccept) return calls.handoffAccept(ctx,b.callId,b.token);
    if(event===C2S.handoffCancel) return calls.handoffCancel(ctx,b.callId,b.token);
  }
  app.get('/v1/call-rooms/capabilities',async(request,reply)=>{try {await auth(request,'calls:read');return {available:true,maxParticipants:8,signaling:'sealed-key-v1',backgroundPush:false};}catch{return reply.code(403).send({error:'forbidden'});} });
  app.get('/v1/call-rooms/ice-servers',async(request,reply)=>{try {const ctx=await auth(request,'calls:read');return {iceServers:turn.iceServersFor(ctx.userId)};}catch{return reply.code(503).send({error:'relay-unavailable'});} });
  app.get('/v1/call-rooms/:callId',async(request,reply)=>{try {const ctx=await auth(request,'calls:read');return calls.callInfo(ctx.userId,uuid.parse((request.params as any).callId));}catch{return reply.code(404).send({error:'not-found'});} });
  app.post('/v1/call-rooms/:callId/reports',async(request,reply)=>{try {const ctx=await auth(request,'safety:write');const callId=uuid.parse((request.params as any).callId);return await serialize(()=>reports.create(ctx.userId,callId,request.body as any));}catch{return reply.code(400).send({error:'invalid-report'});} });
  app.get('/v1/call-rooms/signaling',{websocket:true},(socket,request)=>{
    let ctx:AuthContext|null=null;let count=0;let window=Date.now();let pending=0;let closed=false;let authenticating=false;
    let sendFrame:(value:unknown)=>void=()=>undefined;
    const authDeadline=setTimeout(()=>socket.close(4003,'authentication timeout'),5000);
    const beginAuth=()=>{authenticating=true;void auth(request,'calls:write').then(async verified=>{const principal=await authenticate(request);if(closed)return;const guard=createSocketSessionGuard(socket,principal,db);const send=createAuthorizedSender(socket,guard.authorize);sendFrame=value=>send(JSON.stringify(value));clearTimeout(authDeadline);ctx=verified;emitter.register(socket,verified,send);sendFrame({event:'ready',data:{}});await serialize(()=>calls.resendRings(verified.userId,verified.deviceId));}).catch(()=>socket.close(4003,'unauthorized'));};
    socket.on('close',()=>{clearTimeout(authDeadline);closed=true;if(!ctx)return;emitter.connections.delete(socket);if(![...emitter.connections.values()].some(c=>c.deviceId===ctx!.deviceId))void serialize(()=>calls.deviceDisconnected(ctx!.userId,ctx!.deviceId)).catch(()=>undefined);});
    socket.on('message',raw=>{
      if(closed)return;
      const text=raw.toString();
      if(!ctx){
        if(authenticating)return;
        try{const frame=z.object({event:z.literal('authenticate'),token:z.string().min(20).max(16000)}).strict().parse(JSON.parse(text.length<=17000?text:''));request.headers.authorization=`Bearer ${frame.token}`;beginAuth();}catch{socket.close(4003,'unauthorized');}
        return;
      }if(text.length>600000){socket.close(1009,'frame too large');return;}
      if(Date.now()-window>60000){count=0;window=Date.now();}if(++count>600||pending>=32){socket.close(1008,'rate limited');return;}
      let frame:any;try {frame=JSON.parse(text);if(!Number.isSafeInteger(frame.id)||frame.id<1||typeof frame.event!=='string')throw Error();}catch{socket.close(1008,'invalid frame');return;}
      pending++;void serialize(async()=>{const refreshed=await auth(request,'calls:write');return dispatch(refreshed,frame.event,frame.data);}).then(data=>sendFrame({id:frame.id,ok:true,data})).catch(error=>{if(!(error instanceof CallError)&&!(error instanceof z.ZodError))request.log.error({err:error,event:frame.event},'call room request failed');sendFrame({id:frame.id,ok:false,error:error instanceof CallError ? error.code : error instanceof z.ZodError ? 'invalid-request' : 'request-failed'});}).finally(()=>pending--);
    });
    if(request.headers.authorization)beginAuth();
  });
}
