import { callNative } from '../../../modules/linqa-call-native';
import type { CallManager } from '../CallManager';
import type { CallPeopleDirectory } from '../ports';
export function setupCallSystem(manager:CallManager,_people:CallPeopleDirectory):()=>void {
  let offEngine:(()=>void)|null=null;let engine=manager.state.engine;
  const off=manager.subscribe(s=>{if(s.engine===engine)return;offEngine?.();engine=s.engine;if(!engine)return;
    const current=engine;let started=false;
    offEngine=current.subscribe(state=>{
      if(state.status==='active'&&!started){started=true;try{callNative.startCallService(current.state.callId,current.state.kind==='video');}catch{}}
      if(state.status==='ended')callNative.stopCallService();
    });
  });
  return()=>{off();offEngine?.();callNative.stopCallService();};
}
