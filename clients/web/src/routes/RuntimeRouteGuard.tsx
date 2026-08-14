import { useLinqaRuntime } from "../runtime/RuntimeProvider";

export function RuntimeRouteGuard({
  capability,
  children
}: {
  capability: string;
  children: React.ReactNode;
}) {
  const { snapshot, loading } = useLinqaRuntime();

  if (loading) return <div>Loading…</div>;
  if (!snapshot) return null;

  const state = snapshot.capabilities[capability];
  if (!state?.enabled) {
    return (
      <main className="unavailable-page">
        <h1>Feature unavailable</h1>
        <p>{state?.reason ?? "This feature is not available in the current runtime."}</p>
        <p>Current mode: <strong>{snapshot.mode}</strong></p>
      </main>
    );
  }

  return <>{children}</>;
}
