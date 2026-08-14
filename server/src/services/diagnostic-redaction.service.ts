const SENSITIVE_KEYS = [
  "password", "passcode", "pin", "token", "access_token", "refresh_token",
  "authorization", "cookie", "private_key", "secret", "seed", "mnemonic",
  "plaintext", "message_body", "pan", "card_number", "cvc", "cvv",
  "precise_location", "latitude", "longitude"
];

export class DiagnosticRedactionService {
  redact(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }

    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};

      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive))) {
          out[key] = "[REDACTED]";
        } else {
          out[key] = this.redact(item);
        }
      }

      return out;
    }

    if (typeof value === "string" && value.length > 4096) {
      return `${value.slice(0, 4096)}...[TRUNCATED]`;
    }

    return value;
  }
}
