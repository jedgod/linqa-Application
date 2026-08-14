import { useLinqaRuntime } from "./RuntimeProvider";

export function RuntimeStatusBanner() {
  const { snapshot } = useLinqaRuntime();
  if (!snapshot) return null;

  if (snapshot.mode === "DEMO") {
    return (
      <div className="runtime-banner runtime-banner--demo" role="status">
        <strong>Demo mode</strong>
        <span>
          Mock data and simulated interactions are active. Messages and calls are not secure or transmitted.
        </span>
      </div>
    );
  }

  if (snapshot.mode === "HYBRID") {
    return (
      <div className="runtime-banner runtime-banner--hybrid" role="status">
        <strong>Hybrid mode</strong>
        <span>
          Some services are live. Unavailable features remain disabled or clearly marked as simulated.
        </span>
      </div>
    );
  }

  const liveReady =
    snapshot.serverReachable &&
    snapshot.coreReachable &&
    snapshot.authenticated;

  return (
    <div
      className={`runtime-banner ${liveReady ? "runtime-banner--live" : "runtime-banner--warning"}`}
      role={liveReady ? "status" : "alert"}
    >
      <strong>{liveReady ? "Live secure runtime" : "Live runtime incomplete"}</strong>
      <span>
        {liveReady
          ? "Authenticated server and secure core are available."
          : snapshot.warnings.join(" ")}
      </span>
    </div>
  );
}
