import {useEffect,useLayoutEffect,useMemo,useReducer,useRef} from 'react';
import {Receive,ReceiptQueue,requireScope} from '../shared/receive.mjs';
/** Mount inside a screen keyed by account/device/conversation. */
export function useDurableReceive({scope,live,rows,adapter,parseBody,keyEvents,selfId}) {
 const [,refresh]=useReducer(n=>n+1,0);
 const receiver=useMemo(()=>new Receive(adapter,parseBody,refresh),[adapter,parseBody]);
 const receipts=useMemo(()=>new ReceiptQueue(adapter),[adapter]);
 const rowsRef=useRef(rows);rowsRef.current=rows;
 const key=JSON.stringify([scope.accountId,scope.deviceId,scope.conversationId]);
 useLayoutEffect(()=>{
  requireScope(scope);receiver.enter(scope,live);receipts.reset(scope);
  return()=>receiver.invalidate();
 },[receiver,receipts,key,live]);
 useEffect(()=>{if(live)for(const row of rows)void receiver.open(row);},[receiver,rows,live,key]);
 useEffect(()=>keyEvents?.subscribe(event=>{
  void receiver.verifiedKeys(event,rowsRef.current).catch(()=>undefined);
 }),[receiver,keyEvents,key]);
 const retry=id=>{const row=rowsRef.current.find(r=>r.id===id);if(row)void receiver.open(row,{explicit:true});};
 // Invoke only from viewability callback while foreground, screen focused, LIVE.
 // A successfully decrypted background message is not automatically "read".
 const displayed=async ids=>{
  if(!live||!receiver.live)return;
  const epoch=receiver.epoch;
  const incoming=new Set(rowsRef.current.filter(r=>r.senderId!==selfId).map(r=>r.id));
  const opened=ids.filter(id=>incoming.has(id)&&receiver.entries.get(id)?.state==='open');
  if(!opened.length)return;
  await adapter.recordDisplayed(scope,opened);
  if(receiver.live&&receiver.epoch===epoch)await receipts.flush();
 };
 return {entries:live?receiver.entries:new Map(),retry,displayed,flushReceipts:()=>live?receipts.flush():Promise.resolve()};
}
