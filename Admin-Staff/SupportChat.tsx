import React,{useState} from 'react';
export function SupportChat({caseId,onSend}:{caseId:string;onSend:(body:string)=>Promise<void>}){
 const [body,setBody]=useState(''); const [sending,setSending]=useState(false);
 async function send(){const text=body.trim();if(!text)return;setSending(true);try{await onSend(text);setBody('')}finally{setSending(false)}}
 return <div className="rounded-2xl border bg-white overflow-hidden"><div className="border-b p-4"><div className="font-semibold">Support conversation</div><div className="text-xs text-slate-500">Case {caseId} • messages retained under support policy</div></div><div className="h-80 bg-slate-50 p-4 text-sm text-slate-400">Render authorized support-thread messages here.</div><div className="border-t p-3 flex gap-2"><textarea value={body} onChange={e=>setBody(e.target.value)} className="min-h-20 flex-1 resize-none rounded-xl border p-3 text-sm" placeholder="Reply to client…"/><button disabled={sending} onClick={send} className="self-end rounded-xl bg-slate-950 px-4 py-2 text-sm text-white disabled:opacity-50">Send</button></div></div>
}
