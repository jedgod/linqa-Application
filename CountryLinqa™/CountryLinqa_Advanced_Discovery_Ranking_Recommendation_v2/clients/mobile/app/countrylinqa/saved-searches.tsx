const sample=[
  {id:"1",name:"Ghana Tech Network",summary:"Ghana • Technology • Verified"},
  {id:"2",name:"Canada Education",summary:"Canada • Education • English"},
  {id:"3",name:"West Africa Business",summary:"West Africa • Business"}
];

export default function SavedSearches() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white p-5">
      <h1 className="text-xl font-bold text-violet-700">Saved Searches</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Re-run your preferred discovery filters without rebuilding them.
      </p>
      <div className="mt-5 space-y-3">
        {sample.map(x=>(
          <button key={x.id} className="w-full rounded-2xl border border-zinc-200 p-4 text-left">
            <div className="font-semibold">{x.name}</div>
            <div className="mt-1 text-xs text-zinc-500">{x.summary}</div>
          </button>
        ))}
      </div>
    </main>
  );
}
