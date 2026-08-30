import React, {useMemo,useState} from 'react';
import { Activity, AlertTriangle, BarChart3, CalendarDays, ChevronRight, ClipboardCheck, CreditCard, Headphones, LayoutDashboard, LockKeyhole, MessageCircle, Search, ShieldAlert, ShieldCheck, Siren, Users, Vault, UserRoundCheck } from 'lucide-react';

type PageKey='overview'|'staff'|'client360'|'chat'|'send'|'vault'|'recovery'|'trust'|'risk'|'coaching'|'workforce'|'incidents'|'analytics';
type Row={id:string;title:string;sub:string;badge?:string;value?:string};

const nav:[PageKey,string,React.ElementType][]=[
 ['overview','Operations Overview',LayoutDashboard],['staff','Staff Management',Users],['client360','Client 360',UserRoundCheck],
 ['chat','Real-time Support',MessageCircle],['send','LinqaSend Investigations',CreditCard],['vault','Vault Quarantine',Vault],
 ['recovery','Account Recovery',LockKeyhole],['trust','Trust & Safety',ShieldCheck],['risk','Fraud & Risk',ShieldAlert],
 ['coaching','Supervisor Coaching',ClipboardCheck],['workforce','Workforce Scheduling',CalendarDays],['incidents','Incident Command',Siren],['analytics','Executive Analytics',BarChart3]
];

const data:Record<PageKey,Row[]>={
 overview:[{id:'1',title:'Open support cases',sub:'Across all service queues',value:'1,284',badge:'-8.4%'},{id:'2',title:'SLA at risk',sub:'Due within 15 minutes',value:'37',badge:'Needs attention'},{id:'3',title:'Online staff',sub:'Support + specialist teams',value:'146',badge:'89% staffed'},{id:'4',title:'Critical incidents',sub:'Active production incidents',value:'1',badge:'SEV-1'}],
 staff:[{id:'S-104',title:'Amara K.',sub:'Support • North America',badge:'Online',value:'4 active cases'},{id:'S-118',title:'Daniel M.',sub:'Recovery Specialist',badge:'Busy',value:'3 active cases'},{id:'S-201',title:'Nia T.',sub:'Trust & Safety',badge:'Online',value:'6 reviews'}],
 client360:[{id:'C-82914',title:'Client profile',sub:'Verified phone • recovery email linked',badge:'Low risk',value:'2 devices'},{id:'C-82914-A',title:'Open cases',sub:'Account recovery and calls',badge:'2 open',value:'Last contact 12m ago'},{id:'C-82914-S',title:'Service state',sub:'LinqaSend enabled • Vault normal',badge:'Healthy',value:'CountryLinqa active'}],
 chat:[{id:'CASE-924',title:'Account access after phone change',sub:'Client waiting • assigned to Amara K.',badge:'Live',value:'01:42 SLA'},{id:'CASE-927',title:'LinqaSend transfer pending',sub:'Client replied 2m ago',badge:'Unread',value:'18:14 SLA'}],
 send:[{id:'TX-493002',title:'Transfer risk review',sub:'USD → GHS • provider state pending',badge:'Medium risk',value:'$420.00'},{id:'TX-493018',title:'Recipient verification mismatch',sub:'USD → NGN • manual investigation',badge:'High risk',value:'$980.00'}],
 vault:[{id:'VQ-3031',title:'Incoming social document',sub:'PDF • malware scanner heuristic match',badge:'Quarantined',value:'SHA-256 verified'},{id:'VQ-3034',title:'Client upload',sub:'ZIP • password protected archive',badge:'Needs review',value:'Metadata only'}],
 recovery:[{id:'RC-1004',title:'Lost phone recovery',sub:'Phone + recovery email passed',badge:'3/4 signals',value:'Device signal pending'},{id:'RC-1008',title:'SIM replacement recovery',sub:'Carrier change detected',badge:'Elevated risk',value:'Manual review'}],
 trust:[{id:'TS-665',title:'Harassment report',sub:'User-submitted evidence attached',badge:'Priority',value:'Policy review'},{id:'TS-672',title:'Impersonation report',sub:'Identity claim under review',badge:'Medium',value:'2 related reports'}],
 risk:[{id:'FR-808',title:'Account-link anomaly',sub:'Multiple failed OTP attempts + device change',badge:'86 risk',value:'Escalated'},{id:'FR-812',title:'LinqaSend velocity anomaly',sub:'Unusual recipient sequence',badge:'72 risk',value:'Investigating'}],
 coaching:[{id:'QA-22',title:'Support quality review',sub:'Amara K. • Account Recovery',badge:'94%',value:'Coaching optional'},{id:'QA-24',title:'Policy adherence review',sub:'Team West Africa',badge:'88%',value:'1 follow-up'}],
 workforce:[{id:'WF-1',title:'North America Support',sub:'12:00–20:00 ET',badge:'92% coverage',value:'42 scheduled'},{id:'WF-2',title:'West Africa Support',sub:'16:00–00:00 GMT',badge:'84% coverage',value:'31 scheduled'}],
 incidents:[{id:'INC-41',title:'Push delivery degradation',sub:'FCM regional delivery delay',badge:'SEV-1',value:'Mitigating'},{id:'INC-38',title:'Attachment CDN latency',sub:'Resolved after regional failover',badge:'Resolved',value:'42m duration'}],
 analytics:[{id:'A1',title:'First response SLA',sub:'30-day global performance',badge:'+2.1%',value:'96.8%'},{id:'A2',title:'Case resolution rate',sub:'Resolved without reopen in 7 days',badge:'+1.4%',value:'91.2%'},{id:'A3',title:'Trust & Safety median review',sub:'High-priority reports',badge:'-11m',value:'24m'},{id:'A4',title:'Recovery success',sub:'Verified legitimate recovery attempts',badge:'+3.8%',value:'93.4%'}]
};

function Badge({children}:{children:React.ReactNode}){return <span className="rounded-full border px-2.5 py-1 text-xs font-medium text-slate-600 bg-white">{children}</span>}
function MetricCard({r}:{r:Row}){return <div className="rounded-2xl border bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">{r.title}</div><div className="mt-2 text-3xl font-semibold tracking-tight">{r.value}</div><div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-500">{r.sub}</span>{r.badge&&<Badge>{r.badge}</Badge>}</div></div>}
function ListPanel({rows}:{rows:Row[]}){return <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">{rows.map((r,i)=><button key={r.id} className={`w-full text-left p-5 flex items-center gap-4 hover:bg-slate-50 ${i?'border-t':''}`}><div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">{r.title}</div><div className="mt-1 text-sm text-slate-500">{r.sub}</div></div>{r.badge&&<Badge>{r.badge}</Badge>}<div className="hidden sm:block text-sm font-medium text-slate-700">{r.value}</div><ChevronRight className="h-4 w-4 text-slate-400"/></button>)}</div>}

export default function LinqaOperationsPlatform(){
 const [page,setPage]=useState<PageKey>('overview'); const [query,setQuery]=useState('');
 const meta=useMemo(()=>nav.find(n=>n[0]===page)!,[page]);
 const filtered=data[page].filter(r=>(r.title+r.sub+r.id).toLowerCase().includes(query.toLowerCase()));
 return <div className="min-h-screen bg-slate-50 text-slate-950">
  <aside className="fixed inset-y-0 left-0 hidden w-72 border-r bg-slate-950 text-white xl:flex xl:flex-col">
   <div className="border-b border-white/10 px-6 py-6"><div className="text-xl font-semibold tracking-tight">LINQA</div><div className="mt-1 text-xs text-slate-400">Operations Platform</div></div>
   <nav className="flex-1 overflow-y-auto p-3">{nav.map(([k,label,Icon])=><button key={k} onClick={()=>setPage(k)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${page===k?'bg-white text-slate-950':'text-slate-300 hover:bg-white/10'}`}><Icon className="h-4 w-4"/>{label}</button>)}</nav>
   <div className="border-t border-white/10 p-4"><div className="rounded-xl bg-white/5 p-3 text-xs text-slate-400">Authenticated staff session<br/><span className="text-white">Supervisor • MFA verified</span></div></div>
  </aside>
  <main className="xl:ml-72">
   <header className="sticky top-0 z-20 border-b bg-white/90 backdrop-blur"><div className="flex items-center gap-4 px-5 py-4 lg:px-8"><div className="min-w-0 flex-1"><div className="text-xs font-medium uppercase tracking-wider text-slate-400">Linqa Operations</div><h1 className="truncate text-xl font-semibold">{meta[1]}</h1></div><div className="hidden md:flex w-80 items-center gap-2 rounded-xl border bg-slate-50 px-3"><Search className="h-4 w-4 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} className="w-full bg-transparent py-2.5 text-sm outline-none" placeholder="Search this workspace"/></div><button className="rounded-xl border bg-white px-3 py-2 text-sm">JM</button></div></header>
   <section className="p-5 lg:p-8">
    {page==='overview' || page==='analytics' ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">{filtered.map(r=><MetricCard key={r.id} r={r}/>)}</div> : <ListPanel rows={filtered}/>} 
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2 font-semibold"><Activity className="h-4 w-4"/>Operational activity</div><div className="mt-5 h-48 rounded-xl border border-dashed bg-slate-50 flex items-center justify-center text-sm text-slate-400">Wire to /api/ops events + WebSocket stream</div></div>
      <div className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4"/>Control boundary</div><p className="mt-3 text-sm leading-6 text-slate-600">Privileged actions require RBAC, reason codes and immutable audit events. E2EE message plaintext, Vault plaintext, encryption keys, passwords, CVVs and full payment credentials are not exposed to this console.</p></div>
    </div>
   </section>
  </main>
 </div>
}
