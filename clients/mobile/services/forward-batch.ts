/** A retry keeps each target's message ID and payload; completed targets are skipped. */
export class ForwardBatch<T> {
  private readonly entries=new Map<string,{id:string;payload?:T;ready:boolean;done:boolean;inflight?:Promise<void>}>();
  constructor(private readonly newId:()=>string,private readonly prepare:(target:string,id:string)=>Promise<T>,private readonly deliver:(target:string,id:string,payload:T)=>Promise<unknown>){}
  async send(targets:string[]):Promise<string[]> {
    const unique=[...new Set(targets)];if(unique.length<1||unique.length>5)throw new Error('INVALID_FORWARD_TARGETS');
    const failed:string[]=[];
    for(const target of unique){
      let entry=this.entries.get(target);if(!entry){entry={id:this.newId(),ready:false,done:false};this.entries.set(target,entry);}
      if(entry.done)continue;
      const state=entry;
      if(!state.inflight)state.inflight=(async()=>{if(!state.ready){state.payload=await this.prepare(target,state.id);state.ready=true;}await this.deliver(target,state.id,state.payload as T);state.done=true;})();
      const operation=state.inflight;
      try{await operation;}catch{failed.push(target);}finally{if(state.inflight===operation)state.inflight=undefined;}
    }
    return failed;
  }
}
