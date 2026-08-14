import { useEffect,useState } from "react";
export function MediaGalleryPage({apiBaseUrl,accessToken}:{apiBaseUrl:string;accessToken:string}){
  const[media,setMedia]=useState<any[]>([]),[filter,setFilter]=useState("");
  const[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    setError(null);
    fetch(`${apiBaseUrl}/v1/media${filter?`?mediaType=${filter}`:""}`,{headers:{authorization:`Bearer ${accessToken}`}})
      .then(r=>r.ok?r.json():Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(v=>setMedia(v.media??[]))
      .catch(()=>setError("Unable to load media."));
  },[apiBaseUrl,accessToken,filter]);
  return <main><header><h1>Media</h1><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All</option><option value="IMAGE">Photos</option><option value="VIDEO">Videos</option><option value="VOICE_NOTE">Voice notes</option><option value="DOCUMENT">Documents</option><option value="LINK">Links</option></select></header>{error?<p role="alert">{error}</p>:<div>{media.map(m=><article key={m.id}><strong>{m.media_type}</strong><time>{new Date(m.created_at).toLocaleDateString()}</time>{m.starred&&<span>★</span>}</article>)}</div>}</main>;
}
