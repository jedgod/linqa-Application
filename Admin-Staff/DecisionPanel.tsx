import React,{useState} from 'react';
export function DecisionPanel({title,actions,onSubmit}:{title:string;actions:string[];onSubmit:(x:{action:string;reason:string})=>Promise<void>}){
 const [action,setAction]=useState(actions[0]);const [reason,setReason]=useState('');
 return <div className="rounded-2xl border bg-white p-5"><h3 className="font-semibold">{title}</h3><select value={action} onChange={e=>setAction(e.target.value)} className="mt-4 w-full rounded-xl border p-3 text-sm">{actions.map(a=><option key={a}>{a}</option>)}</select><textarea value={reason} onChange={e=>setReason(e.target.value)} className="mt-3 w-full rounded-xl border p-3 text-sm" placeholder="Required operational reason"/><button disabled={reason.trim().length<5} onClick={()=>onSubmit({action,reason})} className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm text-white disabled:opacity-40">Submit audited decision</button></div>
}
