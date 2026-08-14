import { describe, expect, it } from "vitest";
import { validateIdentifierInput, validateOtpInput } from "./validation";

describe("auth validation", () => {
  it("accepts a valid email", () => {
    const result = validateIdentifierInput(" User@Example.COM ");
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe("user@example.com");
    expect(result.type).toBe("EMAIL");
  });

  it("accepts a valid E.164 phone number", () => {
    const result = validateIdentifierInput("+1 (240) 555-0198");
    expect(result.ok).toBe(true);
    expect(result.normalized).toBe("+12405550198");
    expect(result.type).toBe("PHONE");
  });

  it("rejects an invalid phone number format", () => {
    const result = validateIdentifierInput("1234");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("country code");
  });

  it("accepts a valid six-digit OTP", () => {
    const result = validateOtpInput("123456");
    expect(result.ok).toBe(true);
  });

  it("rejects a short OTP", () => {
    const result = validateOtpInput("12345");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("6-digit");
  });
});
