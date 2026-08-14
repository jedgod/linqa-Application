import { useState } from "react";
import type { CallLocationReceiver, ReceivedCallLocation } from "./CallLocationReceiver";

export function CallLocationBanner({
  callId,
  receiver
}: {
  callId: string;
  receiver: CallLocationReceiver;
}) {
  const [accepted, setAccepted] = useState(receiver.isAccepted());
  const [locations, setLocations] = useState<ReceivedCallLocation[]>([]);
  const [status, setStatus] = useState("");

  async function acceptAndShow() {
    receiver.accept();
    setAccepted(true);
    setStatus("Loading shared location…");

    try {
      const events = await receiver.poll(callId);
      setLocations(events);
      setStatus(events.length ? "" : "No location shared yet.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to load shared location."
      );
    }
  }

  function decline() {
    receiver.decline();
    setAccepted(false);
    setLocations([]);
    setStatus("");
  }

  if (!accepted) {
    return (
      <div className="call-location-banner" role="status">
        <p>The other participant is sharing their location during this call.</p>
        <button type="button" onClick={acceptAndShow}>
          Show location
        </button>
      </div>
    );
  }

  const latest = locations[locations.length - 1];

  return (
    <div className="call-location-banner call-location-banner--accepted" role="status">
      {latest ? (
        <p>
          Shared location: {latest.latitude.toFixed(4)}, {latest.longitude.toFixed(4)}
          {" "}(±{Math.round(latest.accuracyMeters)}m)
        </p>
      ) : (
        <p>{status || "Waiting for location…"}</p>
      )}
      <button type="button" onClick={decline}>
        Stop showing location
      </button>
    </div>
  );
}
