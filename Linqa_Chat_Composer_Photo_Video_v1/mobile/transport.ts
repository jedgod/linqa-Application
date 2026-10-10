import type {Scope} from './sqlite-queue';
export function mediaTransport(apiBase:string,authHeaders:(s:Scope)=>Promise<Record<string,string>>) {
 const url=(s:Scope,id:string)=>`${apiBase}/v1/chats/${encodeURIComponent(s.chatId)}/media/${encodeURIComponent(id)}`;
 async function error(response:Response){let code='UPLOAD_FAILED';try{code=(await response.json()).code??code;}catch{}throw Object.assign(new Error(code),{code,status:response.status});}
 return {
  async upload(s:Scope,input:{uploadId:string;digest:string;bytes:Uint8Array}){
   const headers=await authHeaders(s);
   const body=new Uint8Array(input.bytes).buffer;
   const response=await fetch(url(s,input.uploadId),{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','X-Ciphertext-SHA256':input.digest},body});
   if(!response.ok)await error(response);
   return response.json() as Promise<{uploadId:string;digest:string;byteLength:number}>;
  },
  async download(s:Scope,id:string){const response=await fetch(url(s,id),{headers:await authHeaders(s)});if(!response.ok)await error(response);return{bytes:new Uint8Array(await response.arrayBuffer())};}
 };
}
