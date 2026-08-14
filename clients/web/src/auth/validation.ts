export type IdentifierType = "EMAIL" | "PHONE";

export type ValidationResult<T> =
  | { ok: true; normalized: T; type: IdentifierType }
  | { ok: false; error: string };

export function validateIdentifierInput(raw: string): ValidationResult<string> {
  const value = raw.trim();

  if (!value) {
    return { ok: false, error: "Enter a valid phone number or email." };
  }

  if (value.includes("@")) {
    const email = value.toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return { ok: false, error: "Enter a valid email address." };
    }
    return { ok: true, normalized: email, type: "EMAIL" };
  }

  const phoneDigits = value.replace(/[^\d+]/g, "");
  const normalized = phoneDigits.startsWith("+") ? phoneDigits : `+${phoneDigits}`;
  const phoneOk = /^\+[1-9]\d{7,14}$/.test(normalized);
  if (!phoneOk) {
    return { ok: false, error: "Enter a valid phone number with country code." };
  }

  return { ok: true, normalized, type: "PHONE" };
}

export function validateOtpInput(raw: string): ValidationResult<string> {
  const value = raw.trim();
  if (!/^\d{6}$/.test(value)) {
    return { ok: false, error: "Enter the 6-digit code." };
  }
  return { ok: true, normalized: value, type: "PHONE" };
}
