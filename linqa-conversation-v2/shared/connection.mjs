import {createConversationClient} from './engine.mjs';
// Instantiate once per authenticated account/device (useMemo in React).
// apiOrigin must be your configured HTTPS origin; never derive it from a user.
export function connectConversation({apiOrigin,getAccessToken,getCsrfToken,crypto,actor,uuid}) {
 if(!apiOrigin.startsWith('https://'))throw new Error('Conversation API requires HTTPS');
 const origin=apiOrigin.replace(/\/$/,'');
 async function request(path,{method,body}) {
  const token=await getAccessToken();if(!token)throw new Error('Sign in again');
  const headers={Authorization:`Bearer ${token}`};
  if(body)headers['Content-Type']='application/json';
  if(getCsrfToken && method!=='GET')headers['X-CSRF-Token']=await getCsrfToken();
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await fetch(origin+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:controller.signal});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Conversation request failed');return data;
  }finally{clearTimeout(timer);}
 }
 return createConversationClient({request,crypto,actor,uuid});
}
export async function openPersonConversation({client,peer,navigate}) {
 const {id}=await client.open(peer.id);
 // navigate is supplied by Expo Router, React Router or your desktop router.
 // Navigation receives the canonical conversation UUID, not a phone number.
 navigate({conversationId:id,peer});
}
export function localPreferences({read,write,accountId}) {
 // read/write use the host's device storage. No message text or keys stored here.
 const key=id=>`linqa:conversation:${accountId}:${id}:preferences`;
 return {load:async id=>{const raw=await read(key(id));return raw?JSON.parse(raw):null;},save:async(id,value)=>write(key(id),JSON.stringify(value))};
}
