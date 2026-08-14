import { useEffect,useState } from "react";
export function CallsPage({apiBaseUrl,accessToken}:{apiBaseUrl:string;accessToken:string}){
  const[calls,setCalls]=useState<any[]>([]);
  const[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    setError(null);
    fetch(`${apiBaseUrl}/v1/calls/history`,{headers:{authorization:`Bearer ${accessToken}`}})
      .then(r=>r.ok?r.json():Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(v=>setCalls(v.calls??[]))
      .catch(()=>setError("Unable to load call history."));
  },[apiBaseUrl,accessToken]);
  return <main><header><h1>Calls</h1><button>New call</button></header>{error?<p role="alert">{error}</p>:calls.length===0?<p>No call history yet.</p>:calls.map(c=><article key={c.id}><strong>{c.display_name??"Unknown contact"}</strong><span>{c.call_type} · {c.status}</span><time>{new Date(c.created_at).toLocaleString()}</time></article>)}</main>;
}
