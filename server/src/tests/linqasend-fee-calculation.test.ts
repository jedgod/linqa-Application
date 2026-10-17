import { describe, expect, it } from "vitest";
import { calculateSenderFeeMinor, totalChargedMinor } from "../services/linqasend/fee-calculation.js";

describe("same-day sender fee", () => {
  it("is free for standard delivery", () => {
    expect(calculateSenderFeeMinor(155_090n, "USD", "standard")).toBe(0n);
    expect(totalChargedMinor(155_090n, "USD", "standard")).toBe(155_090n);
  });

  it("charges 1.85% rounded half-up to the cent", () => {
    expect(calculateSenderFeeMinor(156_090n, "USD", "same_day")).toBe(2_888n);   // 1560.90 -> 28.88 (28.8767)
    expect(calculateSenderFeeMinor(55_079n, "USD", "same_day")).toBe(1_019n);    // 550.79  -> 10.19 (10.1896)
    expect(calculateSenderFeeMinor(100_000n, "USD", "same_day")).toBe(1_850n);   // 1000.00 -> 18.50
    expect(totalChargedMinor(156_090n, "USD", "same_day")).toBe(158_978n);
  });

  it("rounds exact half cents up and never loses precision on large amounts", () => {
    expect(calculateSenderFeeMinor(2_703n, "USD", "same_day")).toBe(50n);        // 27.03 * 1.85% = 0.500055 -> 0.50
    expect(calculateSenderFeeMinor(9_007_199_254_740_993n, "USD", "same_day")).toBe(166_633_186_212_708n);
  });

  it("applies a $0.30 minimum for small amounts", () => {
    expect(calculateSenderFeeMinor(100n, "USD", "same_day")).toBe(30n);          // $1.00 -> 0.0185 -> min 0.30
    expect(calculateSenderFeeMinor(1_621n, "USD", "same_day")).toBe(30n);        // 16.21 * 1.85% = 0.2999 -> 0.30
    expect(calculateSenderFeeMinor(1_622n, "USD", "same_day")).toBe(30n);        // 0.3001 -> 0.30
    expect(calculateSenderFeeMinor(1_730n, "USD", "same_day")).toBe(32n);        // 17.30 -> 0.32
  });

  it("scales the minimum to the currency's minor units", () => {
    expect(calculateSenderFeeMinor(1_000n, "KWD", "same_day")).toBe(300n);       // 3-decimal currency: 0.300
    expect(calculateSenderFeeMinor(100n, "JPY", "same_day")).toBe(2n);           // 0-decimal: 1.85% of 100 = 1.85 -> 2, min 0
  });

  it("rejects non-positive amounts", () => {
    expect(() => calculateSenderFeeMinor(0n, "USD", "same_day")).toThrow();
  });
});
