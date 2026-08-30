import { useCallback, useEffect, useState } from "react";

type Dashboard = {
  positions: Array<{ position_date: string; currency: string; safeguarding_asset_minor: string; customer_liability_minor: string; available_liquidity_minor: string }>;
  openBreaks: Array<{ id: string; break_type: string; severity: string; currency: string; delta_minor: string; created_at: string }>;
  recentBatches: Array<{ id: string; provider_id: string; currency: string; status: string; total_minor: string; instruction_count: number }>;
  latestEod: { control_date: string; status: string; evidence_hash: string } | null;
};

function minor(value: string | null | undefined, currency: string): string {
  const amount = BigInt(value ?? "0");
  return `${amount < 0n ? "−" : ""}${(Number(amount < 0n ? -amount : amount) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function LinqaSendMoneyOperationsPage({ apiBaseUrl, accessToken }: { apiBaseUrl: string; accessToken: string }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/v1/linqasend/admin/money-operations`, { headers: { authorization: `Bearer ${accessToken}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Money operations data is unavailable");
      setData(payload); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Money operations data is unavailable"); }
    finally { setLoading(false); }
  }, [apiBaseUrl, accessToken]);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 20_000); return () => window.clearInterval(timer); }, [load]);
  if (loading && !data) return <p>Loading LinqaSend money operations…</p>;
  if (error && !data) return <p role="alert">{error}</p>;
  return (
    <section style={{ display: "grid", gap: 18 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><h2 style={{ margin: 0 }}>LinqaSend Money Operations</h2><p style={{ color: "var(--text-faint, #6b7280)", margin: "4px 0" }}>Safeguarding, liquidity, settlement, reconciliation, and end-of-day evidence.</p></div>
        <button onClick={() => void load()}>Refresh</button>
      </header>
      {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
      <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 10, padding: 14 }}>
        <strong>Latest end-of-day control</strong>
        <div style={{ color: data?.latestEod?.status === "RED" ? "#b42318" : data?.latestEod?.status === "AMBER" ? "#b54708" : "#067647", fontSize: "1.4em", fontWeight: 800 }}>{data?.latestEod?.status ?? "NOT RUN"}</div>
        {data?.latestEod && <small>{data.latestEod.control_date} · evidence {data.latestEod.evidence_hash.slice(0, 16)}…</small>}
      </div>
      <div><h3>Treasury positions</h3><div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr><th align="left">Date</th><th align="left">Currency</th><th align="right">Safeguarding assets</th><th align="right">Customer liabilities</th><th align="right">Available liquidity</th></tr></thead><tbody>{data?.positions.map((p) => <tr key={`${p.position_date}-${p.currency}`}><td>{new Date(p.position_date).toLocaleDateString()}</td><td>{p.currency}</td><td align="right">{minor(p.safeguarding_asset_minor, p.currency)}</td><td align="right">{minor(p.customer_liability_minor, p.currency)}</td><td align="right">{minor(p.available_liquidity_minor, p.currency)}</td></tr>)}</tbody></table></div>{data?.positions.length === 0 && <p>No calculated positions yet.</p>}</div>
      <div><h3>Open reconciliation breaks ({data?.openBreaks.length ?? 0})</h3><ul style={{ listStyle: "none", padding: 0 }}>{data?.openBreaks.map((b) => <li key={b.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border, #e5e7eb)", display: "flex", gap: 12 }}><strong style={{ color: b.severity === "CRITICAL" ? "#b42318" : "#b54708" }}>{b.severity}</strong><span>{b.break_type}</span><span style={{ marginLeft: "auto" }}>{minor(b.delta_minor, b.currency)}</span></li>)}</ul>{data?.openBreaks.length === 0 && <p>No open breaks.</p>}</div>
      <div><h3>Recent settlement batches</h3><ul style={{ listStyle: "none", padding: 0 }}>{data?.recentBatches.map((b) => <li key={b.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}><strong>{b.provider_id}</strong> · {b.status} · {b.instruction_count} instruction(s) · {minor(b.total_minor, b.currency)}</li>)}</ul>{data?.recentBatches.length === 0 && <p>No settlement batches yet.</p>}</div>
    </section>
  );
}
