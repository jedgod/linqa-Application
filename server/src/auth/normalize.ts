import { z } from "zod";

const EmailSchema = z.string().trim().email().max(320);
const PhoneSchema = z.string().trim().min(8).max(32);

export type IdentifierType = "PHONE" | "EMAIL";

export interface NormalizedIdentifier {
  type: IdentifierType;
  normalized: string;
  display: string;
}

export function normalizeIdentifier(raw: string): NormalizedIdentifier {
  const value = raw.trim();

  if (value.includes("@")) {
    const email = EmailSchema.parse(value).toLowerCase();
    return {
      type: "EMAIL",
      normalized: email,
      display: email
    };
  }

  const phone = PhoneSchema.parse(value).replace(/[^\d+]/g, "");
  const normalized = phone.startsWith("+") ? phone : `+${phone}`;

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("invalid phone number");
  }

  return {
    type: "PHONE",
    normalized,
    display: normalized
  };
}
