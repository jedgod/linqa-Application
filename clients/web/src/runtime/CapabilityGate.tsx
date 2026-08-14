import { useLinqaRuntime } from "./RuntimeProvider";

export function CapabilityGate({
  capability,
  children,
  fallback
}: {
  capability: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { snapshot, loading } = useLinqaRuntime();

  if (loading || !snapshot) {
    return fallback ?? <div className="capability-loading">Loading capability…</div>;
  }

  const state = snapshot.capabilities[capability];
  if (!state?.enabled) {
    return (
      fallback ?? (
        <div className="capability-unavailable" role="status">
          <strong>{capability} unavailable</strong>
          <span>{state?.reason ?? "Capability not registered."}</span>
        </div>
      )
    );
  }

  return <>{children}</>;
}
