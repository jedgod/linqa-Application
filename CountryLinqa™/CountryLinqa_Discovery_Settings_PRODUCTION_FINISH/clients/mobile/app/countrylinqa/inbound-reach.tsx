import { useState } from "react";

const OPTIONS = [
  ["MY_COUNTRY","My Country Only","Only eligible users from your verified country."],
  ["SELECTED_COUNTRIES","Selected Countries","Only users in countries you choose."],
  ["REGION","My Region","Allow discovery from your selected region."],
  ["GLOBAL","Worldwide","Allow eligible users worldwide."],
  ["CONTACTS_ONLY","Existing Contacts Only","Do not appear in new-user discovery."]
] as const;

export default function InboundReachScreen() {
  const [value,setValue] = useState("MY_COUNTRY");

  return (
    <main className="mx-auto min-h-screen max-w-md bg-white p-5">
      <h1 className="text-lg font-bold text-violet-700">Who Can Discover Me</h1>
      <p className="mt-2 text-sm text-zinc-500">
        This controls inbound reach. It does not change your verified country.
      </p>

      <div className="mt-5 space-y-3">
        {OPTIONS.map(([id,title,description])=>(
          <button
            key={id}
            onClick={()=>setValue(id)}
            className={[
              "w-full rounded-2xl border p-4 text-left",
              value===id ? "border-violet-500 bg-violet-50" : "border-zinc-200"
            ].join(" ")}
          >
            <div className="flex gap-3">
              <span>{value===id ? "◉" : "○"}</span>
              <div>
                <div className="font-semibold">{title}</div>
                <div className="mt-1 text-xs leading-5 text-zinc-500">{description}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button className="mt-6 min-h-12 w-full rounded-2xl bg-violet-600 font-bold text-white">
        Save Inbound Reach
      </button>
    </main>
  );
}
