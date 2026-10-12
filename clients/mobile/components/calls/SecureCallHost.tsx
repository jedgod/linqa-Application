import React,{ useEffect,useState } from "react";
import { AppState, Platform } from "react-native";
import { useAccounts } from "../../account/AccountContext";
import { AccountSecureStorage } from "../../account/AccountSecureStorage";
import { secureCoreModule } from "../../modules/linqa-secure-core";
import { SecureCoreDevice } from "../../services/secure-core";
import { SecureCoreServer } from "../../services/secure-core-server";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { installCallRoomManager } from "../../services/secure-call-rooms";
import type { CallManager } from "../../features/call-rooms/CallManager";
import type { CallPeopleDirectory } from "../../features/call-rooms/ports";
const api=getApiBaseUrl();const storage=new AccountSecureStorage();
export function SecureCallHost(){
  const {active,loaded}=useAccounts();
  const [content,setContent]=useState<React.ReactNode>(null);
  const [retryVersion,setRetryVersion]=useState(0);
  useEffect(()=>{
    if(!active||!loaded){setContent(null);return;}
    let cancelled=false;let manager:CallManager|null=null;let offNative:(()=>void)|null=null;
    let retryTimer:ReturnType<typeof setTimeout>|null=null;
    const foreground=AppState.addEventListener('change',state=>{if(state==='active'&&!cancelled&&!manager)setRetryVersion(value=>value+1);});
    const userId=active.userId;
    void(async()=>{
      const bridge=secureCoreModule();if(!bridge||typeof bridge.sealCallKey!=='function')return;
      const token=await accessTokenProvider.getAccessToken();
      const cap=await fetch(`${api}/v1/call-rooms/capabilities`,{headers:{Authorization:`Bearer ${token}`}});if(!cap.ok)throw new Error('Call service unavailable');
      const store={get:(key:string)=>storage.get(userId,key),put:(key:string,value:string)=>storage.put(userId,key,value)};
      const device=new SecureCoreDevice(bridge,store,userId);
      await device.ensure();await new SecureCoreServer(api,()=>accessTokenProvider.getAccessToken()).publishKeyPackage(device,store);
      const deviceId=await device.deviceId();if(cancelled)return;
      const [{CallManager},{nativeCallBinding},{HttpKeyDirectory},{CallProvider}]=await Promise.all([import('../../features/call-rooms/CallManager'),import('../../features/call-rooms/setup/nativeBinding'),import('../../features/call-rooms/crypto/httpKeyDirectory'),import('../../features/call-rooms/ui/CallProvider')]);
      const {LinqaCallCrypto}=await import('../../features/call-rooms/crypto/LinqaCallCrypto');if(cancelled)return;
      const session={apiBaseUrl:api,getToken:()=>accessTokenProvider.getAccessToken(),userId,deviceId,deviceName:Platform.OS==='android'?'Android':'iPhone',platform:Platform.OS==='android'?'android' as const:'ios' as const};
      const names=new Map<string,string>([[userId,active.displayName]]);
      // Names of the people you chat with, so a call shows who is calling instead of a generic label. Best effort.
      void fetch(`${api}/v1/chats/inbox`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.ok?r.json():null).then(json=>{for(const item of Array.isArray(json?.conversations)?json.conversations:[]){if(item.peerUserId)names.set(item.peerUserId,String(item.displayName??item.title??item.peerName??'Linqa contact'));}}).catch(()=>undefined);
      const people:CallPeopleDirectory={displayName:id=>names.get(id)??'Linqa contact',addableContacts:async query=>{
        const response=await fetch(`${api}/v1/chats/inbox`,{headers:{Authorization:`Bearer ${await session.getToken()}`}});if(!response.ok)throw new Error('Contacts unavailable');
        const json=await response.json();const items=Array.isArray(json.conversations)?json.conversations:[];const contacts=new Map<string,{userId:string;name:string}>();
        for(const item of items){if(item.peerUserId&&item.peerUserId!==userId){const name=String(item.displayName??item.title??item.peerName??'Linqa contact');names.set(item.peerUserId,name);if(name.toLowerCase().includes(query.toLowerCase()))contacts.set(item.peerUserId,{userId:item.peerUserId,name});}}
        return [...contacts.values()];
      }};
      manager=new CallManager(session,new LinqaCallCrypto(nativeCallBinding(),new HttpKeyDirectory(session),{userId,deviceId}));
      if(cancelled){manager.dispose();return;}const {setupCallSystem}=await import("../../features/call-rooms/native/callSystem");
      if(cancelled){manager.dispose();return;}offNative=setupCallSystem(manager,people);installCallRoomManager(manager);setContent(<CallProvider key={`${userId}:${deviceId}`} manager={manager} people={people}>{null}</CallProvider>);
    })().catch(()=>{if(!cancelled){setContent(null);retryTimer=setTimeout(()=>{if(!cancelled)setRetryVersion(value=>value+1);},5000);}});
    return()=>{cancelled=true;if(retryTimer)clearTimeout(retryTimer);foreground.remove();installCallRoomManager(null);offNative?.();manager?.dispose();setContent(null);};
  },[active?.userId,loaded,retryVersion]);
  return <>{content}</>;
}
