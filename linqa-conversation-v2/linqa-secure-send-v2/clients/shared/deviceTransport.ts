import type {Batch,Transport} from './secure-send.ts';
export function deviceTransport(config:{baseUrl:string;getToken:()=>Promise<string>;fetchImpl:typeof fetch;getCsrfToken?:()=>Promise<string>}):Transport {
 const origin=new URL(config.baseUrl);if(origin.protocol!=='https:'||origin.search||origin.hash||origin.username||origin.password)throw Error('HTTPS_API_REQUIRED');
 const root=config.baseUrl.replace(/\/$/,'')+'/v2/conversations';
 async function request(path:string,method:string,body?:Batch){
  const token=await config.getToken();if(!token)throw Error('SESSION_REQUIRED');
  const headers:Record<string,string>={authorization:`Bearer ${token}`};
  if(body)headers['content-type']='application/json';
  if(body&&config.getCsrfToken)headers['x-csrf-token']=await config.getCsrfToken();
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await config.fetchImpl(root+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:controller.signal});
   if(!response.ok)throw Object.assign(Error(`RELAY_HTTP_${response.status}`),{status:response.status});
   return await response.json();
  }finally{clearTimeout(timer);}
 }
 return {
  post:(id,batch)=>request(`/${encodeURIComponent(id)}/events`,'POST',batch),
  page:(id,cursor)=>request(`/${encodeURIComponent(id)}/events?after=${encodeURIComponent(cursor)}`,'GET')
 };
}
