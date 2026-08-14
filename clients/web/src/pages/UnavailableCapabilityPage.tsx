import { useLinqaRuntime } from "../runtime/RuntimeProvider";

export function UnavailableCapabilityPage() {
  const { snapshot } = useLinqaRuntime();
  const key = new URLSearchParams(window.location.search).get("capability") ?? "";
  const state = snapshot?.capabilities[key];

  return (
    <main className="unavailable-page">
      <h1>Feature unavailable</h1>
      <p>{state?.reason ?? "This feature is not available in the current runtime."}</p>
      <p>
        Current mode: <strong>{snapshot?.mode ?? "Unknown"}</strong>
      </p>
    </main>
  );
}
