export interface TelemetryEvent {
  name: string;
  value?: number;
  attributes?: Record<string, string | number | boolean>;
}

const FORBIDDEN_TERMS = [
  "message",
  "plaintext",
  "ciphertext",
  "phone",
  "email",
  "location",
  "token",
  "authorization",
  "cookie"
];

export class PrivacySafeTelemetry {
  record(event: TelemetryEvent) {
    const serialized = JSON.stringify(event.attributes ?? {}).toLowerCase();
    if (FORBIDDEN_TERMS.some((term) => serialized.includes(term))) {
      throw new Error("Potential sensitive telemetry rejected.");
    }

    console.log(JSON.stringify({
      type: "metric",
      ...event,
      recordedAt: new Date().toISOString()
    }));
  }
}