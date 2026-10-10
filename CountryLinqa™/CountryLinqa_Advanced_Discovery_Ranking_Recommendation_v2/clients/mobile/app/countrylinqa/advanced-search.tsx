import React from "react";

const INTERESTS=["Technology","Travel","Education","Business","Music","Sports","Culture"];
const LANGUAGES=["English","French","Spanish","Arabic","Twi","Japanese"];

export default function AdvancedSearch() {
  const [interests,setInterests]=React.useState<string[]>([]);
  const [languages,setLanguages]=React.useState<string[]>([]);
  const [profession,setProfession]=React.useState("");
  const [verified,setVerified]=React.useState(true);
  const [online,setOnline]=React.useState(false);

  const toggle=(value:string,list:string[],set:(x:string[])=>void)=>
    set(list.includes(value)?list.filter(x=>x!==value):[...list,value]);

  return (
    <main className="mx-auto min-h-screen max-w-md bg-white p-5">
      <h1 className="text-xl font-bold text-violet-700">Advanced Discovery</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Refine eligible CountryLinqa results without changing your discovery scope.
      </p>

      <label className="mt-6 block text-xs font-bold uppercase text-zinc-400">Profession</label>
      <input value={profession} onChange={e=>setProfession(e.target.value)}
        placeholder="e.g. Software Engineering"
        className="mt-2 w-full rounded-2xl border border-zinc-200 p-3 outline-none focus:border-violet-500"/>

      <h2 className="mt-6 text-sm font-bold">Languages</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {LANGUAGES.map(x=><button key={x} onClick={()=>toggle(x,languages,setLanguages)}
          className={`rounded-full px-3 py-2 text-sm ${languages.includes(x)?"bg-violet-600 text-white":"bg-zinc-100"}`}>
          {x}
        </button>)}
      </div>

      <h2 className="mt-6 text-sm font-bold">Interests</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {INTERESTS.map(x=><button key={x} onClick={()=>toggle(x,interests,setInterests)}
          className={`rounded-full px-3 py-2 text-sm ${interests.includes(x)?"bg-violet-600 text-white":"bg-zinc-100"}`}>
          {x}
        </button>)}
      </div>

      <label className="mt-6 flex items-center justify-between rounded-2xl border p-4">
        <span><b className="block text-sm">Verified only</b><small className="text-zinc-500">Hide unverified profiles</small></span>
        <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>
      </label>

      <label className="mt-3 flex items-center justify-between rounded-2xl border p-4">
        <span><b className="block text-sm">Online now</b><small className="text-zinc-500">Recently active users</small></span>
        <input type="checkbox" checked={online} onChange={e=>setOnline(e.target.checked)}/>
      </label>

      <button className="mt-6 min-h-12 w-full rounded-2xl bg-violet-600 font-bold text-white">
        Show Results
      </button>
      <button className="mt-3 min-h-12 w-full rounded-2xl border font-semibold text-violet-700">
        Save This Search
      </button>
    </main>
  );
}
