import { describe, expect, it } from "vitest";
import { generateOtp, verifyOtp } from "../auth/otp.js";
import { normalizeIdentifier } from "../auth/normalize.js";

describe("authentication security", () => {
  it("normalizes email addresses", () => {
    expect(normalizeIdentifier(" User@Example.COM ").normalized)
      .toBe("user@example.com");
  });

  it("normalizes phone numbers to E.164-like form", () => {
    expect(normalizeIdentifier("+1 (240) 555-0198").normalized)
      .toBe("+12405550198");
  });

  it("generates and verifies a six-digit OTP", () => {
    const otp = generateOtp();
    expect(otp.code).toMatch(/^\d{6}$/);
    expect(verifyOtp(otp.code, otp.salt, otp.hash)).toBe(true);
  });

  it("rejects an incorrect OTP", () => {
    const otp = generateOtp();
    expect(verifyOtp("000000", otp.salt, otp.hash)).toBe(false);
  });
});
