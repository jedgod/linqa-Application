import { useState } from "react";
import type { ReleasePromotionClient } from "./ReleasePromotionClient";

export function MilestoneLaunchDashboard({
  client
}: {
  client: ReleasePromotionClient;
}) {
  const [milestoneCode, setMilestoneCode] =
    useState<"1.0" | "2.0" | "3.0">("2.0");
  const [featureKey, setFeatureKey] = useState("");
  const [rolloutPercentage, setRolloutPercentage] = useState(5);
  const [status, setStatus] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Submitting…");

    try {
      const result = await client.request({
        milestoneCode,
        featureKey,
        releaseChannel: "CANARY",
        rolloutPercentage,
        evidence: {
          requestedFrom: "MilestoneLaunchDashboard"
        }
      });
      setStatus(`Promotion ${result.id} is pending approval.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Promotion failed."
      );
    }
  }

  return (
    <form onSubmit={submit} className="launch-dashboard">
      <h2>Milestone launch control</h2>

      <label>
        Milestone
        <select
          value={milestoneCode}
          onChange={(event) =>
            setMilestoneCode(
              event.target.value as "1.0" | "2.0" | "3.0"
            )
          }
        >
          <option value="1.0">Linqa 1.0</option>
          <option value="2.0">Linqa 2.0</option>
          <option value="3.0">Linqa 3.0</option>
        </select>
      </label>

      <label>
        Feature key
        <input
          value={featureKey}
          onChange={(event) => setFeatureKey(event.target.value)}
          required
        />
      </label>

      <label>
        Canary rollout percentage
        <input
          type="number"
          min={0}
          max={100}
          value={rolloutPercentage}
          onChange={(event) =>
            setRolloutPercentage(Number(event.target.value))
          }
        />
      </label>

      <button type="submit">Request promotion</button>
      <p role="status">{status}</p>
    </form>
  );
}
