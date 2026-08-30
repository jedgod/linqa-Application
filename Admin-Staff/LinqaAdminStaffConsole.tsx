import React, { useMemo, useState } from "react";

/**
 * LINQA ADMIN + STAFF OPERATIONS CONSOLE
 * --------------------------------------
 * React + Tailwind/CN-compatible reference implementation.
 * Designed for shadcn-style primitives, but dependency-free for portability.
 *
 * Core goals:
 * - Strict RBAC separation between ADMIN / SUPERVISOR / STAFF / READ_ONLY
 * - Staff monitoring without exposing private message content by default
 * - Client-support case queues with SLA, escalation, safety, identity, billing,
 *   LinqaSend, Vault, Calls, CountryLinqa, account-recovery and abuse categories
 * - Immutable audit-event modeling for sensitive staff actions
 * - Quality/availability/productivity metrics based on operational metadata
 * - Least-privilege access; "break-glass" pattern for exceptional access
 */

type Role = "ADMIN" | "SUPERVISOR" | "STAFF" | "READ_ONLY";
type StaffStatus = "ONLINE" | "BUSY" | "AWAY" | "OFFLINE";
type CaseStatus = "NEW" | "ASSIGNED" | "WAITING_CLIENT" | "ESCALATED" | "RESOLVED";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

type Staff = {
  id: string;
  name: string;
  role: Role;
  team: string;
  status: StaffStatus;
  activeCases: number;
  resolvedToday: number;
  avgFirstResponseMin: number;
  slaPercent: number;
  qaScore: number;
  lastActive: string;
};

type SupportCase = {
  id: string;
  client: string;
  clientId: string;
  category: string;
  subject: string;
  status: CaseStatus;
  priority: Priority;
  owner?: string;
  createdAt: string;
  lastUpdate: string;
  slaMinutesLeft: number;
  channel: "CHAT" | "EMAIL" | "CALL" | "IN_APP";
  risk?: "NONE" | "FRAUD" | "SAFETY" | "ACCOUNT_TAKEOVER" | "PAYMENT";
};

type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
  result: "SUCCESS" | "DENIED" | "REVIEW";
};

const staffSeed: Staff[] = [
  { id: "STF-101", name: "Amara K.", role: "SUPERVISOR", team: "Trust & Safety", status: "ONLINE", activeCases: 6, resolvedToday: 18, avgFirstResponseMin: 3.4, slaPercent: 98, qaScore: 96, lastActive: "Now" },
  { id: "STF-102", name: "Daniel R.", role: "STAFF", team: "Account Support", status: "BUSY", activeCases: 9, resolvedToday: 14, avgFirstResponseMin: 4.2, slaPercent: 94, qaScore: 92, lastActive: "1 min ago" },
  { id: "STF-103", name: "Nadia S.", role: "STAFF", team: "LinqaSend", status: "ONLINE", activeCases: 7, resolvedToday: 21, avgFirstResponseMin: 2.8, slaPercent: 99, qaScore: 95, lastActive: "Now" },
  { id: "STF-104", name: "Michael T.", role: "STAFF", team: "Vault & Security", status: "AWAY", activeCases: 4, resolvedToday: 12, avgFirstResponseMin: 5.1, slaPercent: 91, qaScore: 90, lastActive: "12 min ago" },
];

const caseSeed: SupportCase[] = [
  { id: "LQ-24081", client: "A. Mensah", clientId: "USR-88421", category: "Account Recovery", subject: "Lost access to verified phone", status: "NEW", priority: "HIGH", createdAt: "12:48 PM", lastUpdate: "2 min ago", slaMinutesLeft: 13, channel: "IN_APP", risk: "ACCOUNT_TAKEOVER" },
  { id: "LQ-24080", client: "R. Williams", clientId: "USR-77804", category: "LinqaSend", subject: "Recipient has not received transfer", status: "ASSIGNED", priority: "URGENT", owner: "Nadia S.", createdAt: "12:31 PM", lastUpdate: "4 min ago", slaMinutesLeft: 5, channel: "CHAT", risk: "PAYMENT" },
  { id: "LQ-24077", client: "C. Okafor", clientId: "USR-55014", category: "Privacy / Abuse", subject: "Report harassment and block contact", status: "ESCALATED", priority: "URGENT", owner: "Amara K.", createdAt: "11:44 AM", lastUpdate: "1 min ago", slaMinutesLeft: 2, channel: "CALL", risk: "SAFETY" },
  { id: "LQ-24073", client: "M. Chen", clientId: "USR-33912", category: "LinqaVault", subject: "Social intake file quarantined", status: "WAITING_CLIENT", priority: "NORMAL", owner: "Michael T.", createdAt: "10:15 AM", lastUpdate: "28 min ago", slaMinutesLeft: 47, channel: "EMAIL", risk: "NONE" },
  { id: "LQ-24062", client: "S. Johnson", clientId: "USR-12904", category: "Calls", subject: "Video-call quality issue", status: "ASSIGNED", priority: "NORMAL", owner: "Daniel R.", createdAt: "9:02 AM", lastUpdate: "12 min ago", slaMinutesLeft: 36, channel: "CHAT", risk: "NONE" },
];

const auditSeed: AuditEvent[] = [
  { id: "AUD-90081", actor: "Amara K.", action: "ESCALATE_CASE", target: "LQ-24077", time: "1:09 PM", result: "SUCCESS" },
  { id: "AUD-90080", actor: "Nadia S.", action: "VIEW_PAYMENT_TRACE", target: "LQ-24080", time: "1:07 PM", result: "SUCCESS" },
  { id: "AUD-90079", actor: "Daniel R.", action: "REQUEST_BREAK_GLASS", target: "USR-88421", time: "1:03 PM", result: "REVIEW" },
  { id: "AUD-90078", actor: "Michael T.", action: "DOWNLOAD_VAULT_CONTENT", target: "USR-33912", time: "12:59 PM", result: "DENIED" },
];

const nav = ["Overview", "Live Staff", "Client Cases", "Queues & SLA", "Escalations", "Quality", "Audit", "Roles & Access", "Settings"] as const;
type NavKey = typeof nav[number];

const cx = (...v: Array<string | false | undefined>) => v.filter(Boolean).join(" ");

const badge = (text: string) => {
  const map: Record<string, string> = {
    ONLINE: "bg-emerald-50 text-emerald-700 border-emerald-200",
    BUSY: "bg-amber-50 text-amber-700 border-amber-200",
    AWAY: "bg-slate-50 text-slate-600 border-slate-200",
    OFFLINE: "bg-slate-100 text-slate-500 border-slate-200",
    URGENT: "bg-red-50 text-red-700 border-red-200",
    HIGH: "bg-orange-50 text-orange-700 border-orange-200",
    NORMAL: "bg-blue-50 text-blue-700 border-blue-200",
    LOW: "bg-slate-50 text-slate-600 border-slate-200",
    ESCALATED: "bg-red-50 text-red-700 border-red-200",
    RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    WAITING_CLIENT: "bg-violet-50 text-violet-700 border-violet-200",
    ASSIGNED: "bg-sky-50 text-sky-700 border-sky-200",
    NEW: "bg-amber-50 text-amber-700 border-amber-200",
    SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
    DENIED: "bg-red-50 text-red-700 border-red-200",
    REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return <span className={cx("rounded-full border px-2.5 py-1 text-[11px] font-semibold", map[text] || "bg-slate-50 text-slate-700 border-slate-200")}>{text.replaceAll("_", " ")}</span>;
};

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="text-xs font-medium text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{note}</div>
  </div>;
}

function ShellCard({ title, children, action }: React.PropsWithChildren<{ title: string; action?: React.ReactNode }>) {
  return <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
      <h2 className="font-semibold text-slate-950">{title}</h2>{action}
    </div>
    <div className="p-5">{children}</div>
  </section>;
}

export default function LinqaAdminStaffConsole() {
  const [active, setActive] = useState<NavKey>("Overview");
  const [viewerRole, setViewerRole] = useState<Role>("ADMIN");
  const [query, setQuery] = useState("");
  const [selectedCase, setSelectedCase] = useState<SupportCase | null>(caseSeed[1]);
  const [cases, setCases] = useState(caseSeed);
  const [staff] = useState(staffSeed);

  const visibleCases = useMemo(() => cases.filter(c => `${c.id} ${c.client} ${c.subject} ${c.category}`.toLowerCase().includes(query.toLowerCase())), [cases, query]);
  const online = staff.filter(s => s.status === "ONLINE" || s.status === "BUSY").length;
  const urgent = cases.filter(c => c.priority === "URGENT" && c.status !== "RESOLVED").length;
  const avgSla = Math.round(staff.reduce((a, s) => a + s.slaPercent, 0) / staff.length);

  const canManageStaff = viewerRole === "ADMIN";
  const canEscalate = viewerRole === "ADMIN" || viewerRole === "SUPERVISOR" || viewerRole === "STAFF";
  const canAssign = viewerRole === "ADMIN" || viewerRole === "SUPERVISOR";

  const updateCase = (id: string, patch: Partial<SupportCase>) => {
    setCases(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
    setSelectedCase(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  };

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-5 py-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white">L</div>
        <div className="min-w-0">
          <div className="font-bold leading-tight">LINQA Operations</div>
          <div className="text-xs text-slate-500">Admin & Staff Support Console</div>
        </div>
        <div className="ml-auto hidden max-w-xl flex-1 md:block">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cases, users, categories or case ID…" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
        </div>
        <select value={viewerRole} onChange={e => setViewerRole(e.target.value as Role)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
          <option>ADMIN</option><option>SUPERVISOR</option><option>STAFF</option><option>READ_ONLY</option>
        </select>
        <button className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium">JD ▾</button>
      </div>
    </header>

    <div className="mx-auto grid max-w-[1600px] grid-cols-1 lg:grid-cols-[230px_1fr]">
      <aside className="border-r border-slate-200 bg-white p-4 lg:min-h-[calc(100vh-65px)]">
        <div className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[.18em] text-slate-400">Operations</div>
        <nav className="space-y-1">
          {nav.map(item => <button key={item} onClick={() => setActive(item)} className={cx("w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium transition", active === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100")}>{item}</button>)}
        </nav>
        <div className="mt-6 rounded-2xl bg-slate-950 p-4 text-white">
          <div className="text-xs font-semibold text-slate-300">Privacy default</div>
          <p className="mt-2 text-xs leading-5 text-slate-300">Operational monitoring uses metadata. Private E2EE content is not exposed to supervisors by default.</p>
        </div>
      </aside>

      <main className="min-w-0 p-4 md:p-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-2xl font-bold tracking-tight">{active}</h1><p className="mt-1 text-sm text-slate-500">Monitor support operations, client service, safety, quality and access controls.</p></div>
          <div className="flex gap-2">
            <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold">Export report</button>
            {canManageStaff && <button className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">+ Add staff</button>}
          </div>
        </div>

        {active === "Overview" && <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Staff available" value={`${online}/${staff.length}`} note="Online or actively handling cases" />
            <Kpi label="Open cases" value={String(cases.filter(c => c.status !== "RESOLVED").length)} note="Across all service queues" />
            <Kpi label="Urgent / escalated" value={String(urgent)} note="Requires priority handling" />
            <Kpi label="SLA attainment" value={`${avgSla}%`} note="Today across support teams" />
            <Kpi label="Resolved today" value={String(staff.reduce((a, s) => a + s.resolvedToday, 0))} note="All support teams" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
            <ShellCard title="Live client support queue" action={<button onClick={() => setActive("Client Cases")} className="text-sm font-semibold">View all →</button>}>
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs text-slate-500"><tr><th className="pb-3">Case</th><th>Client</th><th>Category</th><th>Status</th><th>Priority</th><th>Owner</th><th>SLA</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleCases.slice(0,5).map(c => <tr key={c.id} onClick={() => setSelectedCase(c)} className="cursor-pointer hover:bg-slate-50"><td className="py-3 font-semibold">{c.id}</td><td>{c.client}</td><td>{c.category}</td><td>{badge(c.status)}</td><td>{badge(c.priority)}</td><td>{c.owner || "Unassigned"}</td><td className={c.slaMinutesLeft < 10 ? "font-bold text-red-600" : "text-slate-600"}>{c.slaMinutesLeft}m</td></tr>)}</tbody></table></div>
            </ShellCard>
            <ShellCard title="Staff availability">
              <div className="space-y-3">{staff.map(s => <div key={s.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">{s.name.split(" ").map(x=>x[0]).join("")}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{s.name}</div><div className="truncate text-xs text-slate-500">{s.team} · {s.activeCases} active</div></div>{badge(s.status)}</div>)}</div>
            </ShellCard>
          </div>
        </div>}

        {active === "Live Staff" && <ShellCard title="Live staff monitor" action={<span className="text-xs text-slate-500">Metadata-based operational visibility</span>}>
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="pb-3">Staff</th><th>Role</th><th>Team</th><th>Status</th><th>Active cases</th><th>Resolved</th><th>First response</th><th>SLA</th><th>QA</th><th>Last active</th></tr></thead><tbody className="divide-y divide-slate-100">{staff.map(s => <tr key={s.id}><td className="py-4 font-semibold">{s.name}<div className="text-xs font-normal text-slate-400">{s.id}</div></td><td>{s.role}</td><td>{s.team}</td><td>{badge(s.status)}</td><td>{s.activeCases}</td><td>{s.resolvedToday}</td><td>{s.avgFirstResponseMin}m</td><td>{s.slaPercent}%</td><td>{s.qaScore}%</td><td>{s.lastActive}</td></tr>)}</tbody></table></div>
        </ShellCard>}

        {active === "Client Cases" && <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
          <ShellCard title="Client cases">
            <div className="mb-4 md:hidden"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search cases…" className="w-full rounded-xl border border-slate-200 px-3 py-2"/></div>
            <div className="space-y-2">{visibleCases.map(c => <button key={c.id} onClick={() => setSelectedCase(c)} className={cx("w-full rounded-2xl border p-4 text-left", selectedCase?.id === c.id ? "border-slate-950 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50")}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold">{c.subject}</div><div className="mt-1 text-xs text-slate-500">{c.id} · {c.client} · {c.category} · {c.channel}</div></div><div className="flex gap-2">{badge(c.priority)}{badge(c.status)}</div></div><div className="mt-3 flex justify-between text-xs text-slate-500"><span>{c.owner ? `Owner: ${c.owner}` : "Unassigned"}</span><span className={c.slaMinutesLeft < 10 ? "font-semibold text-red-600" : ""}>SLA {c.slaMinutesLeft}m</span></div></button>)}</div>
          </ShellCard>
          <ShellCard title={selectedCase ? `Case ${selectedCase.id}` : "Case detail"}>
            {!selectedCase ? <div className="text-sm text-slate-500">Select a support case.</div> : <div className="space-y-5">
              <div><div className="text-lg font-bold">{selectedCase.subject}</div><div className="mt-1 text-sm text-slate-500">{selectedCase.client} · {selectedCase.clientId}</div></div>
              <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Category</div><div className="mt-1 font-semibold">{selectedCase.category}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-500">Risk</div><div className="mt-1 font-semibold">{selectedCase.risk || "NONE"}</div></div></div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><b>Privacy rule:</b> Staff receives only the minimum client information required for the support purpose. E2EE message bodies are not silently exposed. Exceptional content access must use an authorized, audited workflow.</div>
              <div className="space-y-2">
                <button disabled={!canAssign} onClick={()=>updateCase(selectedCase.id,{owner:"Daniel R.",status:"ASSIGNED"})} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">Assign / reassign</button>
                <button disabled={!canEscalate} onClick={()=>updateCase(selectedCase.id,{status:"ESCALATED",priority:"URGENT"})} className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-35">Escalate case</button>
                <button disabled={viewerRole === "READ_ONLY"} onClick={()=>updateCase(selectedCase.id,{status:"WAITING_CLIENT"})} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold disabled:opacity-35">Request client information</button>
                <button disabled={viewerRole === "READ_ONLY"} onClick={()=>updateCase(selectedCase.id,{status:"RESOLVED"})} className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 disabled:opacity-35">Resolve case</button>
              </div>
            </div>}
          </ShellCard>
        </div>}

        {active === "Queues & SLA" && <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[ ["Account Support",12,96,"15 min"],["Trust & Safety",5,99,"5 min"],["LinqaSend",8,97,"10 min"],["Vault & Security",6,93,"20 min"] ].map(([name,count,sla,target]) => <ShellCard key={String(name)} title={String(name)}><div className="text-3xl font-bold">{count}</div><div className="mt-1 text-xs text-slate-500">Open cases</div><div className="mt-5 flex items-center justify-between text-sm"><span>SLA attainment</span><b>{sla}%</b></div><div className="mt-2 flex items-center justify-between text-sm"><span>First-response target</span><b>{target}</b></div></ShellCard>)}
        </div>}

        {active === "Escalations" && <ShellCard title="Critical escalation center"><div className="space-y-3">{cases.filter(c => c.status === "ESCALATED" || c.priority === "URGENT").map(c => <div key={c.id} className="rounded-2xl border border-red-100 bg-red-50/50 p-4"><div className="flex flex-wrap justify-between gap-2"><div><div className="font-semibold">{c.id} · {c.subject}</div><div className="mt-1 text-xs text-slate-500">{c.client} · Risk: {c.risk} · Owner: {c.owner || "Unassigned"}</div></div>{badge(c.status)}</div></div>)}</div></ShellCard>}

        {active === "Quality" && <div className="grid gap-5 md:grid-cols-2"><ShellCard title="Support QA score"><div className="text-5xl font-black">93.3%</div><p className="mt-3 text-sm text-slate-500">Derived from policy adherence, resolution quality, documentation completeness, escalation correctness and client experience.</p></ShellCard><ShellCard title="QA guardrails"><ul className="space-y-3 text-sm text-slate-600"><li>• Sample cases using risk-based and random review.</li><li>• Redact unnecessary client identifiers.</li><li>• Separate coaching metrics from disciplinary workflows.</li><li>• Require supervisor review for high-risk support actions.</li></ul></ShellCard></div>}

        {active === "Audit" && <ShellCard title="Immutable operational audit log"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="pb-3">Event</th><th>Actor</th><th>Action</th><th>Target</th><th>Time</th><th>Result</th></tr></thead><tbody className="divide-y divide-slate-100">{auditSeed.map(a => <tr key={a.id}><td className="py-4 font-mono text-xs">{a.id}</td><td>{a.actor}</td><td className="font-mono text-xs">{a.action}</td><td>{a.target}</td><td>{a.time}</td><td>{badge(a.result)}</td></tr>)}</tbody></table></div></ShellCard>}

        {active === "Roles & Access" && <div className="grid gap-5 xl:grid-cols-2"><ShellCard title="Role model"><div className="space-y-4 text-sm">{[
          ["ADMIN","Staff lifecycle, RBAC, policy, audit, queues, escalations, configuration"],
          ["SUPERVISOR","Queue assignment, escalation, coaching, QA review, team metrics"],
          ["STAFF","Assigned client support, approved service actions, documentation, escalation"],
          ["READ_ONLY","Operational dashboards and permitted reports; no client-changing actions"],
        ].map(([r,d])=><div key={r} className="rounded-xl border border-slate-200 p-4"><div className="font-bold">{r}</div><div className="mt-1 text-slate-500">{d}</div></div>)}</div></ShellCard><ShellCard title="Sensitive-action controls"><div className="space-y-3 text-sm text-slate-600"><p>• MFA/passkey required for privileged roles.</p><p>• Re-authentication for payout, identity, security and account-recovery actions.</p><p>• Break-glass access requires reason code, short TTL and supervisor/security review.</p><p>• No silent access to E2EE conversations.</p><p>• Every sensitive read/write creates an audit event.</p></div></ShellCard></div>}

        {active === "Settings" && <div className="grid gap-5 md:grid-cols-2"><ShellCard title="Support policy"><div className="space-y-3 text-sm"><label className="flex items-center justify-between"><span>Require MFA for staff</span><input type="checkbox" defaultChecked /></label><label className="flex items-center justify-between"><span>Auto-lock idle sessions</span><input type="checkbox" defaultChecked /></label><label className="flex items-center justify-between"><span>Require reason for sensitive access</span><input type="checkbox" defaultChecked /></label><label className="flex items-center justify-between"><span>Allow staff CSV exports</span><input type="checkbox" /></label></div></ShellCard><ShellCard title="Monitoring policy"><p className="text-sm leading-6 text-slate-600">Monitor availability, queue state, case actions, response time, SLA, QA, security events and service outcomes. Avoid keystroke capture, hidden screen recording, private-message surveillance or unrelated personal monitoring.</p></ShellCard></div>}
      </main>
    </div>
  </div>;
}
