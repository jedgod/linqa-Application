import { useLinqaRuntime } from "./RuntimeProvider";

export function StageDashboard() {
  const { snapshot, loading, refresh } = useLinqaRuntime();

  if (loading || !snapshot) {
    return <div>Inspecting Linqa runtime…</div>;
  }

  const stages = Object.values(snapshot.capabilities)
    .sort((a, b) => a.stage - b.stage);

  return (
    <section className="stage-dashboard">
      <header>
        <div>
          <h2>Linqa Runtime Readiness</h2>
          <p>
            Mode: <strong>{snapshot.mode}</strong>
          </p>
        </div>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>

      <div className="stage-grid">
        {stages.map((stage) => (
          <article
            key={stage.key}
            className={`stage-card stage-card--${stage.status.toLowerCase()}`}
          >
            <div className="stage-card__number">Stage {stage.stage}</div>
            <h3>{stage.key}</h3>
            <p>{stage.reason ?? "Capability ready."}</p>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{stage.status}</dd>
              </div>
              <div>
                <dt>Secure</dt>
                <dd>{stage.secure ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
