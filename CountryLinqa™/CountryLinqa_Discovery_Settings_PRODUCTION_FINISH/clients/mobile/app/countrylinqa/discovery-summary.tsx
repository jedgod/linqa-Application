export default function DiscoverySummary() {
  return (
    <main className="mx-auto min-h-screen max-w-md bg-white p-5">
      <h1 className="text-lg font-bold text-violet-700">Discovery Summary</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Review exactly how CountryLinqa will use your reach and visibility settings.
      </p>

      <section className="mt-5 rounded-2xl border border-zinc-200 p-4">
        <div className="text-xs font-bold uppercase text-zinc-400">You discover</div>
        <div className="mt-1 font-semibold">Selected Countries</div>
        <div className="mt-1 text-sm text-zinc-500">United States, Canada, Ghana</div>
      </section>

      <section className="mt-3 rounded-2xl border border-zinc-200 p-4">
        <div className="text-xs font-bold uppercase text-zinc-400">Who discovers you</div>
        <div className="mt-1 font-semibold">My Country Only</div>
        <div className="mt-1 text-sm text-zinc-500">United States</div>
      </section>

      <section className="mt-3 rounded-2xl border border-zinc-200 p-4">
        <div className="text-xs font-bold uppercase text-zinc-400">Visible location</div>
        <div className="mt-1 font-semibold">Country + State</div>
        <div className="mt-1 text-sm text-zinc-500">City remains private.</div>
      </section>

      <button className="mt-6 min-h-12 w-full rounded-2xl bg-violet-600 font-bold text-white">
        Confirm Settings
      </button>
    </main>
  );
}
