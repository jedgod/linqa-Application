import {useEffect,useRef,useState} from 'react';
import {projectEvents} from './engine.mjs';
export function useConversation(client,id) {
 const [events,setEvents]=useState([]),[error,setError]=useState(''),[pending,setPending]=useState([]),[sending,setSending]=useState(false);
 const state=useRef({id:null,cursor:'0'}), busy=useRef(false);
 useEffect(()=>{
  let cancelled=false, timer; const current={id,cursor:'0'}; state.current=current;
  setEvents([]);setPending([]);setError('');
  async function poll(){
   if(!id)return;
   try {
    let more=true;
    while(more && !cancelled) {
     const page=await client.page(id,current.cursor);
     if(cancelled)return;
     setEvents(old=>{const map=new Map(old.map(x=>[x.id,x]));for(const e of page.events)map.set(e.id,e);return [...map.values()];});
     setPending(old=>old.filter(d=>!page.events.some(e=>e.client_id===d.clientId && e.sender_id===client.actor.userId)));
     current.cursor=page.cursor; more=page.hasMore;
    }
    if(!cancelled)setError('');
   }catch(e){if(!cancelled)setError(e.message||'Unable to load messages');}
   finally{if(!cancelled)timer=setTimeout(poll,3000);}
  }
  poll();return()=>{cancelled=true;clearTimeout(timer);};
 },[client,id]);
 async function attempt(draft){
  if(busy.current || !id)return false;
  busy.current=true;setSending(true);const context=state.current;
  setPending(old=>[...old.filter(x=>x.clientId!==draft.clientId),{...draft,status:'sending'}]);
  try{
   await client.send(id,draft);
   if(state.current===context)setPending(old=>old.map(x=>x.clientId===draft.clientId?{...x,status:'accepted'}:x));
   return true;
  }catch(e){
   if(state.current===context){setError(e.message||'Send failed');setPending(old=>old.map(x=>x.clientId===draft.clientId?{...x,status:'failed'}:x));}
   return false;
  }finally{busy.current=false;setSending(false);}
 }
 return {messages:projectEvents(events),pending,error,sending,
  send:payload=>attempt(client.draft(payload)),retry:attempt};
}
