import { C2S,S2C } from "./protocol";
import type { CallSession } from "./ports";
type Handler=(data:any)=>void;

export class SignalingClient {
  private socket:WebSocket|null=null; private disposed=false; private ready=false; private connectedOnce=false;
  private retry:ReturnType<typeof setTimeout>|null=null;private id=0;
  private handlers=new Map<string,Set<Handler>>();private reconnect=new Set<()=>void>();
  private pending=new Map<number,{resolve:(data:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private readonly session:CallSession) {void this.connect();}
  private async connect() {
    if(this.disposed)return;
    try {
      const token=await this.session.getToken();if(this.disposed)return;
      const socket=new WebSocket(this.session.apiBaseUrl.replace(/^http/,'ws')+'/v1/call-rooms/signaling');
      socket.onopen=()=>socket.send(JSON.stringify({event:'authenticate',token}));
      this.socket=socket;
      socket.onmessage=e=>{
        if(this.socket!==socket||typeof e.data!=='string'||e.data.length>600000)return;
        let frame:any;try{frame=JSON.parse(e.data);}catch{return;}
        if(frame.event==='ready') {this.ready=true;if(this.connectedOnce)this.reconnect.forEach(fn=>fn());this.connectedOnce=true;return;}
        if(Number.isSafeInteger(frame.id)) {const p=this.pending.get(frame.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(frame.id);frame.ok ? p.resolve(frame.data) : p.reject(new CallRequestError(frame.error));return;}
        if(Object.values(S2C).includes(frame.event))this.handlers.get(frame.event)?.forEach(fn=>{try{Promise.resolve(fn(frame.data)).catch(()=>undefined);}catch{}});
      };
      socket.onerror=()=>socket.close();
      socket.onclose=()=>{
        if(this.socket!==socket)return;this.ready=false;this.socket=null;
        for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('call-connection-lost'));}this.pending.clear();
        if(!this.disposed)this.retry=setTimeout(()=>void this.connect(),1000);
      };
    }catch{if(!this.disposed)this.retry=setTimeout(()=>void this.connect(),1000);}
  }
  get connected(){return this.ready;}
  on(event:(typeof S2C)[keyof typeof S2C],fn:Handler){let set=this.handlers.get(event);if(!set)this.handlers.set(event,set=new Set());set.add(fn);return()=>{set!.delete(fn);};}
  onReconnect(fn:()=>void){this.reconnect.add(fn);return()=>{this.reconnect.delete(fn);};}
  async request<T>(event:(typeof C2S)[keyof typeof C2S],data:unknown,timeoutMs=10000):Promise<T> {
    const start=Date.now();while(!this.ready&&!this.disposed&&Date.now()-start<timeoutMs)await new Promise(r=>setTimeout(r,50));
    if(this.disposed||!this.ready||!this.socket)throw new Error('call-connection-unavailable');
    if(this.pending.size>=64)throw new Error('too-many-call-requests');
    const id=++this.id;return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('call-request-timeout'));},Math.max(1,timeoutMs-(Date.now()-start)));
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket!.send(JSON.stringify({id,event,data}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  close(){this.disposed=true;this.ready=false;if(this.retry)clearTimeout(this.retry);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('calls-disposed'));}this.pending.clear();this.socket?.close();this.handlers.clear();this.reconnect.clear();}
}

export class CallRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Human text for server error codes shown in the UI. */
export function errorText(code: string): string {
  const map: Record<string, string> = {
    'call-full': 'This call is full.',
    'cannot-call-user': "You can't call this person.",
    'device-offline': 'That device is offline.',
    'handoff-expired': 'The switch timed out. Try again.',
    'in-call-on-other-device': "You're already in this call on another device. Use Switch device.",
    'call-ended': 'The call has ended.',
    'already-reported': "You've already reported this.",
  };
  return map[code] ?? 'Something went wrong. Try again.';
}
