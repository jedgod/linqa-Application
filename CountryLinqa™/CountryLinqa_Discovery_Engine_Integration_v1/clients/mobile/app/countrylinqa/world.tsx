import React from "react";

const tabs=["People","Posts","Events","Businesses","Communities"] as const;

export default function CountryLinqaWorld() {
  const [tab,setTab]=React.useState<typeof tabs[number]>("People");

  return (
    <main className="mx-auto min-h-screen max-w-md bg-white">
      <header className="px-5 pb-3 pt-5">
        <div className="text-xs font-bold uppercase tracking-wide text-violet-500">
          CountryLinqa™
        </div>
        <h1 className="mt-1 text-2xl font-bold">Discover</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Results automatically respect your CountryLinqa reach and privacy settings.
        </p>
      </header>

      <nav className="flex gap-2 overflow-x-auto px-5 py-3">
        {tabs.map(x=>(
          <button
            key={x}
            onClick={()=>setTab(x)}
            className={[
              "whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold",
              tab===x ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-600"
            ].join(" ")}
          >
            {x}
          </button>
        ))}
      </nav>

      <section className="px-5 py-4">
        <div className="rounded-2xl border border-zinc-200 p-4">
          <div className="font-semibold">{tab}</div>
          <div className="mt-2 text-sm text-zinc-500">
            Bind this panel to the corresponding discovery-engine endpoint.
            Filtering must remain server-authoritative.
          </div>
        </div>
      </section>
    </main>
  );
}
