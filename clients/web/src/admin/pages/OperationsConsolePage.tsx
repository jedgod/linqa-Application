import { useMemo, useState } from "react";
import {
  OperationsApiClient,
  type CaseWorkspace,
  type OpsCase,
  type SupportMessage,
  type Client360Projection,
  type RecoveryEvidence,
  type FraudRiskEvidence,
  type LinqaSendEvidence,
  type SpecialistDecision,
  type SpecialistDecisionInput,
  type SpecialistReview
} from "../api/operations-api";
import { usePolling } from "../hooks/useOperationsPolling";
import { hasOpsScope } from "../../app/opsAccess";
import { LinqaSendMoneyOperationsPage } from "./LinqaSendMoneyOperationsPage";

function formatBytes(n?: number | null): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function Client360Panel({ data, loading, error }: { data?: Client360Projection | null; loading?: boolean; error?: string | null }) {
  if (loading && !data) return <p>Loading Client 360…</p>;
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return null;
  if (!data.userId) return <p style={{ color: "var(--text-faint, #6b7280)" }}>No linked user account on this case.</p>;

  const riskColor =
    data.risk?.level === "CRITICAL" || data.risk?.level === "HIGH"
      ? "#b42318"
      : data.risk?.level === "MEDIUM"
        ? "#b54708"
        : "#067647";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <div>
          <div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Country</div>
          <div>{data.identity?.countryCode ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Member since</div>
          <div>{data.identity?.memberSince ? new Date(data.identity.memberSince).toLocaleDateString() : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Email verified</div>
          <div>{data.identity?.emailVerified == null ? "—" : data.identity.emailVerified ? "Yes" : "No"}</div>
        </div>
        <div>
          <div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Phone verified</div>
          <div>{data.identity?.phoneVerified == null ? "—" : data.identity.phoneVerified ? "Yes" : "No"}</div>
        </div>
      </div>

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        <li>
          <strong>Devices:</strong>{" "}
          {data.devices ? `${data.devices.trustedDeviceCount} trusted, ${data.devices.activeDeviceCount} active in last 30d` : "Unavailable"}
        </li>
        <li>
          <strong>LinqaSend:</strong>{" "}
          {data.linqaSend ? `${data.linqaSend.enabled ? data.linqaSend.accountState : "Not set up"}${data.linqaSend.activeHoldCount ? ` · ${data.linqaSend.activeHoldCount} on hold` : ""}` : "Unavailable"}
        </li>
        <li>
          <strong>Vault:</strong>{" "}
          {data.vault ? `${data.vault.enabled ? "In use" : "Empty"} · ${formatBytes(data.vault.usedBytes)}` : "Unavailable"}
        </li>
        <li>
          <strong>Recovery:</strong>{" "}
          {data.recovery
            ? `Recovery email ${data.recovery.recoveryEmailConfigured ? "configured" : "not configured"} · ${data.recovery.passkeyCount ?? 0} passkey(s)`
            : "Unavailable"}
        </li>
        <li>
          <strong>Risk:</strong>{" "}
          {data.risk ? (
            <span style={{ color: riskColor, fontWeight: 600 }}>
              {data.risk.level}
              {data.risk.openRiskCaseCount ? ` · ${data.risk.openRiskCaseCount} open report(s)` : ""}
              {data.risk.safetyRestrictionActive ? " · account restricted" : ""}
            </span>
          ) : (
            "Unavailable"
          )}
        </li>
      </ul>

      {Object.values(data.availability).some((v) => !v) && (
        <p style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.8em" }}>Some Client 360 summaries are temporarily unavailable. Case operations remain available.</p>
      )}
    </div>
  );
}

// Shared header + decision form for the three specialist reviews. Each panel
// renders its own evidence between them; everything else about the workflow --
// the PENDING/APPROVED badge, note and reason inputs, scope gating, the
// "don't approve on thin evidence" nudge -- is identical, so it lives here
// once rather than three times.
function SpecialistReviewHeader({ scopeNote, review }: { scopeNote: string; review: SpecialistReview | null | undefined }) {
  const currentDecision = review?.decision ?? "PENDING";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>{scopeNote}</span>
      <span style={{ fontWeight: 700, color: currentDecision === "APPROVED" ? "#067647" : currentDecision === "REJECTED" ? "#b42318" : "#b54708" }}>
        {currentDecision}
      </span>
    </div>
  );
}

function SpecialistDecisionForm({
  defaultReason,
  canReview,
  canApprove,
  missingReviewScope,
  thinEvidenceWarning,
  failureMessage,
  onDecision
}: {
  defaultReason: string;
  canReview: boolean;
  canApprove: boolean;
  missingReviewScope: string;
  thinEvidenceWarning?: string | null;
  failureMessage: string;
  onDecision: (input: SpecialistDecisionInput) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(defaultReason);
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");

  async function decide(decision: SpecialistDecision) {
    if (!canReview) return;
    if (decision === "APPROVED" && !canApprove) {
      setDecisionError("Approval scope required.");
      return;
    }
    if (!note.trim()) {
      setDecisionError("Specialist note is required.");
      return;
    }
    setBusy(true);
    setDecisionError("");
    try {
      await onDecision({ decision, specialistNote: note.trim(), reasonCode: reason.trim() || defaultReason });
      setNote("");
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <strong>Specialist decision</strong>
      {thinEvidenceWarning && <p style={{ color: "#b54708", fontSize: "0.85em" }}>{thinEvidenceWarning}</p>}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!canReview || busy}
        placeholder="Document the evidence reviewed and rationale."
        rows={4}
        style={{ width: "100%", boxSizing: "border-box" }}
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={!canReview || busy}
        style={{ width: "100%", boxSizing: "border-box", marginTop: 6 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button disabled={!canApprove || busy} onClick={() => decide("APPROVED")}>Approve</button>
        <button disabled={!canReview || busy} onClick={() => decide("REJECTED")}>Reject</button>
        <button disabled={!canReview || busy} onClick={() => decide("ESCALATED")}>Escalate</button>
      </div>
      {decisionError && (
        <p role="alert" style={{ color: "#b42318" }}>
          {decisionError}
        </p>
      )}
      {!canReview && <p style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.8em" }}>Your account doesn't have {missingReviewScope}.</p>}
    </div>
  );
}

function RecoverySpecialistPanel({
  data, loading, error, canReview, canApprove, onDecision
}: {
  data?: RecoveryEvidence | null; loading?: boolean; error?: string | null;
  canReview: boolean; canApprove: boolean;
  onDecision: (input: SpecialistDecisionInput) => Promise<void>;
}) {
  if (loading && !data) return <p>Loading recovery evidence…</p>;
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return null;
  if (!data.userId) return <p style={{ color: "var(--text-faint, #6b7280)" }}>No linked user account on this case.</p>;

  const summary = data.evidence.summary;
  const hasStrongEvidence = summary.verifiedRecoveryEmailCount > 0 || summary.trustedDeviceCount > 0 || summary.activePasskeyCount > 0;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SpecialistReviewHeader scopeNote="Evidence review only. No credential mutation." review={data.review} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Verified recovery emails</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.verifiedRecoveryEmailCount}</div></div>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Trusted devices</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.trustedDeviceCount}</div></div>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Active passkeys</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.activePasskeyCount}</div></div>
      </div>

      <div>
        <strong>Recovery email evidence</strong>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.evidence.recoveryEmails.length === 0 && <li style={{ color: "var(--text-faint, #6b7280)" }}>No recovery email evidence found.</li>}
          {data.evidence.recoveryEmails.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <span>{item.maskedEmail}</span>
              <span style={{ color: item.verified ? "#067647" : "#b54708" }}>{item.verified ? "VERIFIED" : item.state}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <strong>Trusted devices</strong>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.evidence.trustedDevices.length === 0 && <li style={{ color: "var(--text-faint, #6b7280)" }}>No trusted-device evidence found.</li>}
          {data.evidence.trustedDevices.map((item) => (
            <li key={item.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <div>{item.label}</div>
              <div style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>{item.platform ?? "Platform unavailable"} · {item.trusted ? "Trusted" : item.state}</div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <strong>Passkeys</strong>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.evidence.passkeys.length === 0 && <li style={{ color: "var(--text-faint, #6b7280)" }}>No passkey evidence found.</li>}
          {data.evidence.passkeys.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <span>{item.label}</span>
              <span style={{ color: item.active ? "#067647" : "var(--text-faint, #6b7280)" }}>{item.active ? "ACTIVE" : "INACTIVE"}</span>
            </li>
          ))}
        </ul>
      </div>

      <SpecialistDecisionForm
        defaultReason="RECOVERY_REVIEW"
        canReview={canReview}
        canApprove={canApprove}
        missingReviewScope="ops:recovery:review"
        thinEvidenceWarning={
          hasStrongEvidence ? null : "No strong recovery evidence is currently visible. Escalation or rejection may be more appropriate than approval."
        }
        failureMessage="Recovery decision failed."
        onDecision={onDecision}
      />
    </div>
  );
}

// Minor units -> a readable amount. The server sends send_amount_minor
// verbatim; nothing here re-derives a rate or a fee.
function formatMinor(minor: number, currency: string): string {
  return `${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

const RISK_LEVEL_COLOR: Record<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL", string> = {
  CRITICAL: "#b42318",
  HIGH: "#b42318",
  MEDIUM: "#b54708",
  LOW: "#067647"
};

function FraudRiskPanel({
  data, loading, error, canReview, canApprove, onDecision
}: {
  data?: FraudRiskEvidence | null; loading?: boolean; error?: string | null;
  canReview: boolean; canApprove: boolean;
  onDecision: (input: SpecialistDecisionInput) => Promise<void>;
}) {
  if (loading && !data) return <p>Loading fraud &amp; risk evidence…</p>;
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return null;
  if (!data.userId) return <p style={{ color: "var(--text-faint, #6b7280)" }}>No linked user account on this case.</p>;

  const { summary, risk, user } = data.evidence;
  const actionable =
    summary.openSafetyReportCount > 0 ||
    summary.highValueTransferCount > 0 ||
    summary.unverifiedPaymentMethodCount > 0 ||
    summary.userSuspended;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SpecialistReviewHeader
        scopeNote="Evidence review only. Approving does not release a hold or lift a restriction."
        review={data.review}
      />

      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <span style={{ fontWeight: 700, color: RISK_LEVEL_COLOR[risk.level] }}>{risk.level}</span>
        <span style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>
          {risk.score == null ? "No scored transfers" : `Worst transfer risk score ${risk.score}`}
          {" · "}Account {user.status ?? "UNKNOWN"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Open safety reports</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.openSafetyReportCount}</div></div>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>High-value transfers</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.highValueTransferCount}</div></div>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Unverified methods</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.unverifiedPaymentMethodCount}</div></div>
      </div>

      <div>
        <strong>Safety reports</strong>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.evidence.safetyReports.length === 0 && <li style={{ color: "var(--text-faint, #6b7280)" }}>No safety reports filed about this account.</li>}
          {data.evidence.safetyReports.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <span>{item.category}</span>
              <span style={{ color: item.open ? RISK_LEVEL_COLOR[item.severity] : "var(--text-faint, #6b7280)" }}>
                {item.severity} · {item.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <strong>LinqaSend exposure</strong>
        <p style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em", margin: "4px 0" }}>
          {data.evidence.paymentMethods.length} payment method(s), {summary.unverifiedPaymentMethodCount} unverified ·{" "}
          {data.evidence.transfers.length} recent transfer(s), {summary.highValueTransferCount} high-value
        </p>
      </div>

      <SpecialistDecisionForm
        defaultReason="RISK_REVIEW"
        canReview={canReview}
        canApprove={canApprove}
        missingReviewScope="ops:risk:review"
        thinEvidenceWarning={
          actionable ? null : "No actionable fraud or risk evidence is currently visible. There may be nothing here to rule on yet."
        }
        failureMessage="Risk decision failed."
        onDecision={onDecision}
      />
    </div>
  );
}

const ATTENTION_COLOR: Record<"NORMAL" | "REVIEW" | "HIGH", string> = {
  HIGH: "#b42318",
  REVIEW: "#b54708",
  NORMAL: "#067647"
};

function LinqaSendPanel({
  data, loading, error, canReview, canApprove, onDecision
}: {
  data?: LinqaSendEvidence | null; loading?: boolean; error?: string | null;
  canReview: boolean; canApprove: boolean;
  onDecision: (input: SpecialistDecisionInput) => Promise<void>;
}) {
  if (loading && !data) return <p>Loading LinqaSend evidence…</p>;
  if (error && !data) return <p role="alert">{error}</p>;
  if (!data) return null;
  if (!data.userId) return <p style={{ color: "var(--text-faint, #6b7280)" }}>No linked user account on this case.</p>;

  const { summary } = data.evidence;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <SpecialistReviewHeader
        scopeNote="Evidence review only. No hold release, reversal, refund or payment-method change."
        review={data.review}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Payment methods</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.verifiedPaymentMethodCount}/{summary.paymentMethodCount}</div><div style={{ fontSize: "0.75em", color: "var(--text-faint, #6b7280)" }}>verified</div></div>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Needs attention</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.attentionTransferCount}</div><div style={{ fontSize: "0.75em", color: "var(--text-faint, #6b7280)" }}>of {summary.transferCount} transfers</div></div>
        <div><div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>Failed / disputed</div><div style={{ fontSize: "1.4em", fontWeight: 700 }}>{summary.failedTransferCount}</div></div>
      </div>

      <div>
        <strong>Payment methods</strong>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.evidence.paymentMethods.length === 0 && <li style={{ color: "var(--text-faint, #6b7280)" }}>No payment methods on this account.</li>}
          {data.evidence.paymentMethods.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <span>
                {item.type}
                {item.maskedReference ? ` ${item.maskedReference}` : ""}
              </span>
              <span style={{ color: item.verified ? "#067647" : "#b54708" }}>{item.verificationStatus}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <strong>Transfers</strong>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.evidence.transfers.length === 0 && <li style={{ color: "var(--text-faint, #6b7280)" }}>No transfers on this account.</li>}
          {data.evidence.transfers.map((item) => (
            <li key={item.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {item.direction === "SENT" ? "↑" : "↓"} {formatMinor(item.sendAmountMinor, item.sendCurrency)}
                  {item.receiveCurrency !== item.sendCurrency && ` → ${formatMinor(item.receiveAmountMinor, item.receiveCurrency)}`}
                </span>
                <span style={{ color: ATTENTION_COLOR[item.attention], fontWeight: item.attention === "NORMAL" ? 400 : 600 }}>{item.status}</span>
              </div>
              <div style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.8em" }}>
                {item.publicId}
                {item.failureCode ? ` · ${item.failureCode}` : ""}
                {item.paymentMethodVerified === false ? " · unverified method" : ""}
                {" · "}
                {new Date(item.createdAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <SpecialistDecisionForm
        defaultReason="LINQASEND_REVIEW"
        canReview={canReview}
        canApprove={canApprove}
        missingReviewScope="ops:linqasend:review"
        thinEvidenceWarning={
          summary.attentionTransferCount > 0 ? null : "No transfer on this account is currently flagged for attention."
        }
        failureMessage="LinqaSend decision failed."
        onDecision={onDecision}
      />
    </div>
  );
}

const PRIORITY_LABEL: Record<OpsCase["priority"], string> = {
  URGENT: "Urgent",
  HIGH: "High",
  NORMAL: "Normal",
  LOW: "Low"
};

export function OperationsConsolePage({ apiBaseUrl, accessToken }: { apiBaseUrl: string; accessToken: string }) {
  const client = useMemo(() => new OperationsApiClient(apiBaseUrl, accessToken), [apiBaseUrl, accessToken]);
  const [tab, setTab] = useState<"overview" | "my-work" | "money-operations">("overview");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  const me = usePolling(() => client.me(), 60000, [client]);
  const overview = usePolling(() => client.overview(), 20000, [client]);
  const liveStaff = usePolling(() => client.liveStaff(), 20000, [client]);
  const myWork = usePolling(() => client.myWork(), 15000, [client]);
  const unassigned = usePolling(() => client.unassigned(), 15000, [client]);

  function refreshLists() {
    unassigned.refresh();
    myWork.refresh();
    overview.refresh();
  }

  async function assignToMe(caseId: string) {
    // /staff/me resolves the caller's own ops_staff_profiles.id from their
    // JWT userId, so this no longer needs the manual staff-ID prompt from
    // the previous pass. Falls back to a prompt only for the edge case of
    // an ops-scoped caller with no staff profile row yet.
    const staffId = me.data?.id ?? window.prompt("No staff profile found for you. Assign to which staff profile ID instead?");
    if (!staffId) return;
    setBusyCaseId(caseId);
    setActionError(null);
    try {
      await client.assign(caseId, staffId, me.data ? "Picked up by assignee" : "Picked up from unassigned queue");
      refreshLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setBusyCaseId(null);
    }
  }

  async function releaseCase(caseId: string) {
    const reason = window.prompt("Reason for releasing this case?", "No longer working this case");
    if (!reason) return;
    setBusyCaseId(caseId);
    setActionError(null);
    try {
      await client.release(caseId, reason);
      refreshLists();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Release failed");
    } finally {
      setBusyCaseId(null);
    }
  }

  return (
    <main style={{ padding: 4 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Operations</h1>
        <nav style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("overview")} aria-pressed={tab === "overview"}>
            Overview
          </button>
          <button onClick={() => setTab("my-work")} aria-pressed={tab === "my-work"}>
            My Work{myWork.data ? ` (${myWork.data.length})` : ""}
          </button>
          {hasOpsScope(accessToken, "ops:linqasend:read") && <button onClick={() => setTab("money-operations")} aria-pressed={tab === "money-operations"}>Money Operations</button>}
        </nav>
        {me.data && <span style={{ marginLeft: "auto", color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>Signed in as {me.data.displayName}</span>}
      </header>

      {actionError && (
        <p role="alert" style={{ color: "#b42318" }}>
          {actionError}
        </p>
      )}

      {tab === "overview" && (
        <>
          {overview.error && <p role="alert">{overview.error}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 20 }}>
            <Stat label="Open cases" value={overview.data?.openCases} />
            <Stat label="Unassigned" value={overview.data?.unassignedCases} />
            <Stat label="Resolved today" value={overview.data?.resolvedToday} />
            <Stat label="Staff available" value={overview.data ? `${overview.data.availableStaff}/${overview.data.totalStaff}` : undefined} />
          </div>

          <h2>Live staff</h2>
          {liveStaff.error && <p role="alert">{liveStaff.error}</p>}
          {liveStaff.data?.length === 0 && <p>No staff profiles yet.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {liveStaff.data?.map((s) => (
              <li key={s.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                <strong style={{ minWidth: 160 }}>{s.displayName}</strong>
                <span style={{ color: "var(--text-faint, #6b7280)" }}>{s.staffRole}{s.teamName ? ` · ${s.teamName}` : ""}</span>
                <span>{s.presence}</span>
                <span style={{ marginLeft: "auto" }}>
                  {s.activeCases}/{s.maxConcurrentCases} cases
                </span>
              </li>
            ))}
          </ul>

          <h2>Unassigned cases</h2>
          {unassigned.error && <p role="alert">{unassigned.error}</p>}
          {unassigned.data?.length === 0 && <p>Nothing waiting for an owner.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {unassigned.data?.map((c) => (
              <li key={c.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                <button onClick={() => setOpenCaseId(c.id)} style={{ minWidth: 90, background: "none", border: "none", color: "var(--link, #2563eb)", cursor: "pointer", padding: 0, textAlign: "left" }}>
                  #{c.caseNumber}
                </button>
                <span style={{ flex: 1 }}>{c.subject}</span>
                <span>{PRIORITY_LABEL[c.priority]}</span>
                <button disabled={busyCaseId === c.id} onClick={() => assignToMe(c.id)}>
                  {busyCaseId === c.id ? "Assigning…" : "Assign to me"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "my-work" && (
        <>
          {myWork.error && <p role="alert">{myWork.error}</p>}
          {myWork.data?.length === 0 && <p>No cases assigned to you right now.</p>}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {myWork.data?.map((c) => (
              <li key={c.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                <button onClick={() => setOpenCaseId(c.id)} style={{ minWidth: 90, background: "none", border: "none", color: "var(--link, #2563eb)", cursor: "pointer", padding: 0, textAlign: "left" }}>
                  #{c.caseNumber}
                </button>
                <div style={{ flex: 1 }}>
                  <div>{c.subject}</div>
                  <div style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>
                    {c.category} · {c.state} · {PRIORITY_LABEL[c.priority]}
                  </div>
                </div>
                <button disabled={busyCaseId === c.id} onClick={() => releaseCase(c.id)}>
                  {busyCaseId === c.id ? "Releasing…" : "Release"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "money-operations" && <LinqaSendMoneyOperationsPage apiBaseUrl={apiBaseUrl} accessToken={accessToken} />}

      {openCaseId && (
        <CaseWorkspacePanel
          caseId={openCaseId}
          client={client}
          accessToken={accessToken}
          onClose={() => setOpenCaseId(null)}
          onChanged={refreshLists}
        />
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div style={{ border: "1px solid var(--border, #e5e7eb)", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: "0.8em", color: "var(--text-faint, #6b7280)" }}>{label}</div>
      <div style={{ fontSize: "1.5em", fontWeight: 700 }}>{value ?? "—"}</div>
    </div>
  );
}

function CaseWorkspacePanel({
  caseId,
  client,
  accessToken,
  onClose,
  onChanged
}: {
  caseId: string;
  client: OperationsApiClient;
  accessToken: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const workspace = usePolling<CaseWorkspace>(() => client.getCase(caseId), 15000, [client, caseId]);
  const messages = usePolling<SupportMessage[]>(() => client.listMessages(caseId), 5000, [client, caseId]);
  const client360 = usePolling<Client360Projection>(() => client.getClient360(caseId), 15000, [client, caseId]);
  const recovery = usePolling<RecoveryEvidence>(() => client.getRecoveryEvidence(caseId), 15000, [client, caseId]);
  const canReviewRecovery = hasOpsScope(accessToken, "ops:recovery:review");
  const canApproveRecovery = hasOpsScope(accessToken, "ops:recovery:approve");

  // Only poll the specialist evidence a caller is actually allowed to read --
  // a SUPPORT_AGENT has ops:risk:read but not ops:linqasend:read, and a
  // RECOVERY_SPECIALIST has neither, so unconditional polling would spray
  // 400s from requireScope every 15s for most roles.
  const canReadRisk = hasOpsScope(accessToken, "ops:risk:read");
  const canReadLinqaSend = hasOpsScope(accessToken, "ops:linqasend:read");
  const fraudRisk = usePolling<FraudRiskEvidence | null>(
    () => (canReadRisk ? client.getFraudRiskEvidence(caseId) : Promise.resolve(null)),
    15000,
    [client, caseId, canReadRisk]
  );
  const linqaSend = usePolling<LinqaSendEvidence | null>(
    () => (canReadLinqaSend ? client.getLinqaSendEvidence(caseId) : Promise.resolve(null)),
    15000,
    [client, caseId, canReadLinqaSend]
  );
  const canReviewRisk = hasOpsScope(accessToken, "ops:risk:review");
  const canApproveRisk = hasOpsScope(accessToken, "ops:risk:approve");
  const canReviewLinqaSend = hasOpsScope(accessToken, "ops:linqasend:review");
  const canApproveLinqaSend = hasOpsScope(accessToken, "ops:linqasend:approve");

  async function submitRecoveryDecision(input: SpecialistDecisionInput) {
    await client.submitRecoveryDecision(caseId, input);
    recovery.refresh();
    onChanged();
  }

  async function submitFraudRiskDecision(input: SpecialistDecisionInput) {
    await client.submitFraudRiskDecision(caseId, input);
    fraudRisk.refresh();
    workspace.refresh();
    onChanged();
  }

  async function submitLinqaSendDecision(input: SpecialistDecisionInput) {
    await client.submitLinqaSendDecision(caseId, input);
    linqaSend.refresh();
    workspace.refresh();
    onChanged();
  }
  const [noteDraft, setNoteDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [fieldBusy, setFieldBusy] = useState<"state" | "priority" | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  async function submitReply(event: React.FormEvent) {
    event.preventDefault();
    const body = replyDraft.trim();
    if (!body) return;
    setReplying(true);
    setReplyError(null);
    try {
      await client.reply(caseId, body);
      setReplyDraft("");
      messages.refresh();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Reply failed to send");
    } finally {
      setReplying(false);
    }
  }

  async function changeState(state: OpsCase["state"]) {
    const reason = window.prompt(`Reason for moving this case to ${state}?`, "CASE_WORKSPACE");
    if (!reason) return;
    setFieldBusy("state");
    setFieldError(null);
    try {
      await client.updateState(caseId, state, reason);
      workspace.refresh();
      onChanged();
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Could not update state");
    } finally {
      setFieldBusy(null);
    }
  }

  async function changePriority(priority: OpsCase["priority"]) {
    const reason = window.prompt(`Reason for changing priority to ${priority}?`, "CASE_WORKSPACE");
    if (!reason) return;
    setFieldBusy("priority");
    setFieldError(null);
    try {
      await client.updatePriority(caseId, priority, reason);
      workspace.refresh();
      onChanged();
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : "Could not update priority");
    } finally {
      setFieldBusy(null);
    }
  }

  async function submitNote(event: React.FormEvent) {
    event.preventDefault();
    const body = noteDraft.trim();
    if (!body) return;
    setPosting(true);
    setNoteError(null);
    try {
      await client.addNote(caseId, body);
      setNoteDraft("");
      workspace.refresh();
      onChanged();
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Case workspace"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 20
      }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(560px, 100%)", height: "100%", background: "var(--surface, #fff)", overflowY: "auto", padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ float: "right" }} aria-label="Close case workspace">
          ✕
        </button>

        {workspace.error && <p role="alert">{workspace.error}</p>}
        {!workspace.data && !workspace.error && <p>Loading case…</p>}

        {workspace.data && (
          <>
            <h2 style={{ marginBottom: 0 }}>
              Case #{workspace.data.case.case_number} · {workspace.data.case.subject}
            </h2>
            <p style={{ color: "var(--text-faint, #6b7280)", marginTop: 4 }}>{workspace.data.case.category}</p>
            <p>{workspace.data.case.description}</p>

            <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ fontSize: "0.85em" }}>
                State
                <br />
                <select
                  value={workspace.data.case.state}
                  disabled={fieldBusy !== null}
                  onChange={(e) => changeState(e.target.value as OpsCase["state"])}
                >
                  <option value="OPEN">OPEN</option>
                  <option value="WAITING_USER">WAITING_USER</option>
                  <option value="WAITING_INTERNAL">WAITING_INTERNAL</option>
                  <option value="RESOLVED">RESOLVED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
                {fieldBusy === "state" && " Saving…"}
              </label>

              <label style={{ fontSize: "0.85em" }}>
                Priority
                <br />
                <select
                  value={workspace.data.case.priority}
                  disabled={fieldBusy !== null}
                  onChange={(e) => changePriority(e.target.value as OpsCase["priority"])}
                >
                  {(Object.keys(PRIORITY_LABEL) as OpsCase["priority"][]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
                {fieldBusy === "priority" && " Saving…"}
              </label>
            </div>
            {fieldError && (
              <p role="alert" style={{ color: "#b42318" }}>
                {fieldError}
              </p>
            )}

            <h3>Assignment</h3>
            <p>
              {workspace.data.assignedStaff
                ? `${workspace.data.assignedStaff.displayName} (${workspace.data.assignedStaff.staffRole}${workspace.data.assignedStaff.teamName ? `, ${workspace.data.assignedStaff.teamName}` : ""})`
                : "Unassigned"}
            </p>

            <h3>Client 360</h3>
            <Client360Panel data={client360.data} loading={client360.loading} error={client360.error} />

            <h3>Recovery Specialist</h3>
            <RecoverySpecialistPanel
              data={recovery.data}
              loading={recovery.loading}
              error={recovery.error}
              canReview={canReviewRecovery}
              canApprove={canApproveRecovery}
              onDecision={submitRecoveryDecision}
            />

            {canReadRisk && (
              <>
                <h3>Fraud &amp; Risk</h3>
                <FraudRiskPanel
                  data={fraudRisk.data}
                  loading={fraudRisk.loading}
                  error={fraudRisk.error}
                  canReview={canReviewRisk}
                  canApprove={canApproveRisk}
                  onDecision={submitFraudRiskDecision}
                />
              </>
            )}

            {canReadLinqaSend && (
              <>
                <h3>LinqaSend Investigation</h3>
                <LinqaSendPanel
                  data={linqaSend.data}
                  loading={linqaSend.loading}
                  error={linqaSend.error}
                  canReview={canReviewLinqaSend}
                  canApprove={canApproveLinqaSend}
                  onDecision={submitLinqaSendDecision}
                />
              </>
            )}

            <h3>Customer conversation</h3>
            <p style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em", marginTop: -8 }}>Internal notes are never shown here.</p>
            {messages.error && <p role="alert">{messages.error}</p>}
            <ul style={{ listStyle: "none", padding: 0, maxHeight: 320, overflowY: "auto", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8 }}>
              {messages.data?.map((m) => {
                const staff = m.direction === "STAFF_TO_CLIENT";
                return (
                  <li key={m.id} style={{ padding: 10, display: "flex", justifyContent: staff ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        maxWidth: "80%",
                        borderRadius: 10,
                        padding: "8px 10px",
                        background: staff ? "var(--accent-soft, #dcfce7)" : "var(--surface-muted, #f3f4f6)"
                      }}
                    >
                      <div style={{ fontSize: "0.8em", fontWeight: 600 }}>{m.authorName}</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                      <div style={{ fontSize: "0.75em", color: "var(--text-faint, #6b7280)", marginTop: 4, textAlign: "right" }}>
                        {new Date(m.createdAt).toLocaleTimeString()}
                        {staff && ` · ${m.deliveryStatus}`}
                      </div>
                    </div>
                  </li>
                );
              })}
              {messages.data?.length === 0 && <li style={{ padding: 10, color: "var(--text-faint, #6b7280)" }}>No messages yet.</li>}
            </ul>
            <form onSubmit={submitReply} style={{ marginTop: 8 }}>
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                disabled={!workspace.data.clientSummary}
                placeholder={workspace.data.clientSummary ? "Reply to the client…" : "No linked client account on this case."}
                maxLength={8000}
                rows={3}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
              {replyError && (
                <p role="alert" style={{ color: "#b42318" }}>
                  {replyError}
                </p>
              )}
              <button type="submit" disabled={replying || !replyDraft.trim() || !workspace.data.clientSummary}>
                {replying ? "Sending…" : "Send reply"}
              </button>
            </form>

            <h3>Support events</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {workspace.data.events
                .filter((e) => !e.private)
                .map((e) => (
                  <li key={e.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                    <span style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>
                      {new Date(e.created_at).toLocaleString()} · {e.actor_type}
                    </span>
                    <div>{e.body ?? e.event_type}</div>
                  </li>
                ))}
              {workspace.data.events.filter((e) => !e.private).length === 0 && <li>No events yet.</li>}
            </ul>

            <h3>Internal notes</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {workspace.data.notes.map((n) => (
                <li key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
                  <strong>{n.author_display_name ?? "Staff"}</strong>{" "}
                  <span style={{ color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>{new Date(n.created_at).toLocaleString()}</span>
                  <div>{n.body}</div>
                </li>
              ))}
              {workspace.data.notes.length === 0 && <li>No internal notes yet.</li>}
            </ul>

            <form onSubmit={submitNote} style={{ marginTop: 8 }}>
              <textarea
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add an internal note (not visible to the client)…"
                rows={3}
                style={{ width: "100%", boxSizing: "border-box" }}
              />
              {noteError && <p role="alert">{noteError}</p>}
              <button type="submit" disabled={posting || !noteDraft.trim()}>
                {posting ? "Adding…" : "Add note"}
              </button>
            </form>

            <h3>History</h3>
            <ul style={{ listStyle: "none", padding: 0, color: "var(--text-faint, #6b7280)", fontSize: "0.85em" }}>
              {workspace.data.events.map((e) => (
                <li key={e.id}>
                  {new Date(e.created_at).toLocaleString()} — {e.event_type}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
