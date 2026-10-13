import { useEffect, useState } from "react";
import { Directory, File, Paths } from "expo-file-system";
import { useAccounts } from "../account/AccountContext";
import { registerAccountScopeReset } from "./account-scope";

/**
 * The events and meetings this person has added to Linqa from chats: they show under Upcoming on Home and Calls, and the whole
 * list, past ones included, is the Event log. It is kept on this phone only (an event's title is sealed inside the chat message, so
 * the server never sees it). Adding the same event twice just updates it.
 */
export interface MyEvent {
  id: string;
  kind: "event" | "meeting";
  title: string;
  startsAt: string;
  endsAt: string;
  place?: string;
  note?: string;
  addedAt: string;
}


const LIMIT = 500;
const listeners = new Set<() => void>();
const cache=new Map<string,MyEvent[]>();
const queues=new Map<string,Promise<void>>();
registerAccountScopeReset("my-events",()=>{cache.clear();listeners.forEach(l=>l());});

function storeFile(userId:string): File { if(!/^[A-Za-z0-9-]{1,100}$/.test(userId))throw new Error("EVENT_ACCOUNT_REQUIRED");return new File(new Directory(Paths.document), `linqa-my-events-${userId}.json`); }

async function read(userId:string):Promise<MyEvent[]> {
  if(cache.has(userId))return cache.get(userId)!;
  const file=storeFile(userId);const parsed:unknown=file.exists?JSON.parse(await file.text()):[];
  if(!Array.isArray(parsed))throw new Error('INVALID_EVENT_LOG');
  const items=parsed.filter(valid).slice(-LIMIT);cache.set(userId,items);return items;
}
function valid(e:unknown):e is MyEvent {
  if(!e||typeof e!=='object')return false;const v=e as MyEvent;
  return typeof v.id==='string'&&v.id.length>0&&v.id.length<=100&&(v.kind==='event'||v.kind==='meeting')&&typeof v.title==='string'&&v.title.length<=500&&Number.isFinite(Date.parse(v.startsAt))&&Number.isFinite(Date.parse(v.endsAt))&&Date.parse(v.endsAt)>=Date.parse(v.startsAt)&&Number.isFinite(Date.parse(v.addedAt))&&(v.place===undefined||typeof v.place==='string')&&(v.note===undefined||typeof v.note==='string');
}
function write(userId:string,items:MyEvent[]):void {
  const file=storeFile(userId);if(!file.exists)file.create();file.write(JSON.stringify(items));
  cache.set(userId,items);listeners.forEach(l=>l());
}
function mutate(userId:string,work:()=>Promise<void>):Promise<void> {
  const result=(queues.get(userId)??Promise.resolve()).catch(()=>undefined).then(work);queues.set(userId,result);return result;
}
export async function listMyEvents(userId:string):Promise<MyEvent[]> {return [...await read(userId)].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));}
export function addMyEvent(userId:string,event:Omit<MyEvent,'addedAt'>):Promise<void> {
  return mutate(userId,async()=>{const items=await read(userId);const value={...event,addedAt:items.find(e=>e.id===event.id)?.addedAt??new Date().toISOString()};if(!valid(value))throw new Error('INVALID_EVENT');write(userId,[...items.filter(e=>e.id!==event.id),value].slice(-LIMIT));});
}
export function removeMyEvent(userId:string,id:string):Promise<void>{return mutate(userId,async()=>write(userId,(await read(userId)).filter(e=>e.id!==id)));}
export async function isInMyEvents(userId:string,id:string):Promise<boolean>{return (await read(userId)).some(e=>e.id===id);}

// Old versions did not record an owner. Preserve that file and let the person
// explicitly choose the account to import it into instead of exposing it on switch.
export function hasLegacyEvents(userId:string):boolean {
  return new File(new Directory(Paths.document),'linqa-my-events.json').exists&&!new File(new Directory(Paths.document),`linqa-events-imported-${userId}.txt`).exists;
}
export function importLegacyEvents(userId:string):Promise<void> {
  return mutate(userId,async()=>{
    const file=new File(new Directory(Paths.document),'linqa-my-events.json');
    if(!file.exists)return;
    const parsed:unknown=JSON.parse(await file.text());if(!Array.isArray(parsed))throw new Error('INVALID_EVENT_LOG');
    const items=new Map((await read(userId)).map(e=>[e.id,e]));for(const e of parsed.filter(valid))if(!items.has(e.id))items.set(e.id,e);
    write(userId,[...items.values()].slice(-LIMIT));
    const marker=new File(new Directory(Paths.document),`linqa-events-imported-${userId}.txt`);if(!marker.exists)marker.create();marker.write('imported');
  });
}

/** The saved events (oldest first). Updates when something is added or removed. */
export function useMyEvents():{items:MyEvent[];loaded:boolean;error:boolean} {
  const {active}=useAccounts();const userId=active?.userId;
  const [state,setState]=useState<{userId?:string;items:MyEvent[];loaded:boolean;error:boolean}>({items:[],loaded:false,error:false});
  useEffect(()=>{let live=true;const refresh=()=>{if(!userId){setState({items:[],loaded:true,error:false});return;}void listMyEvents(userId).then(items=>{if(live)setState({userId,items,loaded:true,error:false});},()=>{if(live)setState({userId,items:[],loaded:true,error:true});});};refresh();listeners.add(refresh);const timer=setInterval(refresh,60000);return()=>{live=false;listeners.delete(refresh);clearInterval(timer);};},[userId]);
  // Reclassify at the end time without scheduling a notification or waiting for a tap.
  useEffect(() => {
    const now = Date.now();
    const next = Math.min(...state.items.map(item => Date.parse(item.endsAt)).filter(end => end > now));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setState(current => ({ ...current, items: [...current.items] })), Math.min(next - now + 1, 60_000));
    return () => clearTimeout(timer);
  }, [state.items]);
  return state.userId===userId?state:{items:[],loaded:false,error:false};
}

/** Events that have not ended yet, soonest first. */
export const upcomingOf = (items: MyEvent[], now = Date.now()) => items.filter((e) => Date.parse(e.endsAt || e.startsAt) > now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
export const pastOf = (items: MyEvent[], now = Date.now()) => items.filter((e) => Date.parse(e.endsAt || e.startsAt) <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
