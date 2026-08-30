import React from 'react';
export function Client360Panel({client}:{client:any}){
 const fields=[['Phone',client.maskedPhone],['Email',client.maskedEmail],['Country',client.country],['Account',client.accountState],['Risk',client.riskBand],['Devices',client.activeDevices]];
 return <section className="rounded-2xl border bg-white p-5"><div className="flex justify-between"><h2 className="font-semibold">Client 360</h2><span className="text-xs rounded-full border px-2 py-1">Minimum necessary view</span></div><div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{fields.map(([k,v])=><div key={k} className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">{k}</div><div className="mt-1 text-sm font-medium">{String(v??'—')}</div></div>)}</div></section>
}
