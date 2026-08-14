import type { SecurityRuntimeState } from "../services/CoreBridge";

export function SecurityStatusBanner({ state }: { state: SecurityRuntimeState }) {
  if (state.kind === "ready") {
    return (
      <div className="security-banner security-banner--ready" role="status">
        <strong>Secure core active.</strong>
        <span>
          End-to-end encryption is available. Post-quantum mode:{" "}
          {state.pqcActive ? "active" : "inactive"}.
        </span>
      </div>
    );
  }

  const text =
    state.kind === "loading"
      ? "Loading cryptographic core. Sending is disabled."
      : state.kind === "demo"
        ? `Demo mode: ${state.reason} Messages are not end-to-end encrypted.`
        : state.kind === "failed" || state.kind === "unavailable"
          ? `Secure core unavailable: ${state.reason} Sending is disabled.`
          : "Secure state unavailable.";

  return (
    <div className="security-banner security-banner--warning" role="alert">
      <strong>Not a secure messenger yet.</strong>
      <span>{text}</span>
    </div>
  );
}
