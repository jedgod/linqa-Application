import { getApiBaseUrl } from "../config/api";
import { accessTokenProvider } from "./session";
import type { CallManager } from "../features/call-rooms/CallManager";
let manager:CallManager|null=null;
export function installCallRoomManager(next:CallManager|null){manager=next;}
export async function startSecureCall(conversationId:string,kind:"AUDIO"|"VIDEO",userIds:string[]):Promise<string|null>{
  if(!manager)return "Secure calling is still connecting. Rebuild the dev client if this continues.";
  try {await manager.startCall(conversationId,kind==='VIDEO'?'video':'voice',userIds);return null;}catch(error){return error instanceof Error?error.message:'Unable to start secure call.';}
}

export async function startSecureCallForPeer(peerUserId:string,kind:"AUDIO"|"VIDEO"):Promise<string|null>{
  try {
    const response=await fetch(`${getApiBaseUrl()}/v1/chats/inbox`,{headers:{Authorization:`Bearer ${await accessTokenProvider.getAccessToken()}`}});
    if(!response.ok)return "Could not load this contact's conversation.";
    const json=await response.json();const chat=(json.conversations??[]).find((c:any)=>c.peerUserId===peerUserId);
    if(!chat)return "Open this contact's conversation to start a secure call.";
    return startSecureCall(chat.conversationId,kind,[peerUserId]);
  }catch{return "Could not connect to secure calling.";}
}
