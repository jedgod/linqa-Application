export const THEMES = {
 violet:{background:'#F5F3FC',surface:'#FFFFFF',ink:'#211B43',accent:'#6947D7',incoming:'#ECE7F8',highlight:'#FFD8B4'},
 midnight:{background:'#17162B',surface:'#25233D',ink:'#F5F2FF',accent:'#9F87FF',incoming:'#35314E',highlight:'#F8C79F'},
 apricot:{background:'#FFF5EE',surface:'#FFFFFF',ink:'#392535',accent:'#8651AD',incoming:'#F7E5D9',highlight:'#FFC28D'}
};
export const LANES = ['All','Plans','Ideas'];
export function validatePayload(p) {
 if(!p || !['text','decision','vote'].includes(p.type)) throw new Error('Unsupported message');
 if(p.type==='text' && (typeof p.text!=='string' || !p.text.trim() || p.text.length>8000 || !['Plans','Ideas','General'].includes(p.lane))) throw new Error('Invalid message');
 if(p.type==='decision' && (typeof p.title!=='string' || !p.title.trim() || p.title.length>200 || !Array.isArray(p.options) || p.options.length<2 || p.options.length>5 || new Set(p.options).size!==p.options.length || p.options.some(x=>typeof x!=='string'||!x.trim()||x.length>100))) throw new Error('Invalid decision');
 if(p.type==='vote' && (typeof p.boardId!=='string' || !Number.isInteger(p.choice) || p.choice<0 || p.choice>4)) throw new Error('Invalid vote');
 return p;
}
export function projectEvents(events) {
 const sorted=[...events].sort((a,b)=>BigInt(a.seq)<BigInt(b.seq)?-1:BigInt(a.seq)>BigInt(b.seq)?1:0);
 const boards = new Map(); const messages=[];
 for(const event of sorted) {
  const p=event.payload;
  if(p.type==='decision') { const board={...event,votes:{}}; boards.set(event.client_id,board); messages.push(board); }
  if(p.type==='text') messages.push(event);
  if(p.type==='vote') {const board=boards.get(p.boardId); if(board && p.choice<board.payload.options.length) board.votes[event.sender_id]=p.choice;}
 }
 return messages;
}
export function createConversationClient({request,crypto,actor,uuid}) {
 if(!request || !crypto?.encryptForDevices || !crypto?.decryptAuthenticated || !uuid) throw new Error('Missing authenticated messaging adapters');
 const root='/v2/conversations';
 return {
  actor,
  open:peerId=>request(`${root}/direct`,{method:'POST',body:{peerId}}),
  list:()=>request(root,{method:'GET'}),
  async page(id,cursor) {
   const page=await request(`${root}/${encodeURIComponent(id)}/events?after=${encodeURIComponent(cursor)}`,{method:'GET'});
   const events=[];
   for(const e of page.events) {
    // Adapter MUST verify device signature, replay protections and AAD; return
    // plaintext only after verifying sender account/device in the key directory.
    const payload=await crypto.decryptAuthenticated(e.ciphertext,{conversationId:id,senderId:e.sender_id,clientId:e.client_id});
    events.push({...e,payload:validatePayload(payload)});
   }
   return {...page,events};
  },
  draft(payload) { return {clientId:uuid(),payload:validatePayload(payload)}; },
  async send(id,draft) {
   const envelopes=await crypto.encryptForDevices(draft.payload,{conversationId:id,senderId:actor.userId,clientId:draft.clientId});
   return request(`${root}/${encodeURIComponent(id)}/events`,{method:'POST',body:{clientId:draft.clientId,envelopes}});
  }
 };
}
