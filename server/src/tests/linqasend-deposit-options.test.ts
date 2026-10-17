import { describe, expect, it } from "vitest";
import { addBusinessDays, isBusinessDay, usFederalHolidays } from "../services/linqasend/business-days.js";
import { depositOptionsFor } from "../services/linqasend/deposit-options.js";

const at = (iso: string) => new Date(iso); // all times below are midday US Eastern unless noted

describe("US business days", () => {
  it("counts three business days, skipping weekends", () => {
    expect(addBusinessDays(at("2026-10-14T16:00:00Z"), 3)).toBe("2026-10-19"); // Wed -> Thu, Fri, Mon
    expect(addBusinessDays(at("2026-10-09T16:00:00Z"), 3)).toBe("2026-10-15"); // Fri -> Mon Oct 12 is Columbus Day, so Tue, Wed, Thu
  });
  it("skips federal holidays and weekend-observed holidays", () => {
    expect(addBusinessDays(at("2026-11-24T17:00:00Z"), 3)).toBe("2026-11-30"); // Tue -> Wed, Fri (Thanksgiving Thu skipped), Mon
    expect(addBusinessDays(at("2026-12-22T17:00:00Z"), 3)).toBe("2026-12-28"); // Wed, Thu, (Fri Dec 25 holiday, weekend), Mon
    expect(usFederalHolidays(2027).has("2027-12-24")).toBe(true);              // Dec 25 2027 is a Saturday: observed Friday
    expect(isBusinessDay("2026-07-03")).toBe(false);                           // Jul 4 2026 is a Saturday: observed Friday
    expect(isBusinessDay("2026-10-19")).toBe(true);
  });
  it("starts counting from the next day and uses US Eastern dates", () => {
    expect(addBusinessDays(at("2026-10-17T02:30:00Z"), 1)).toBe("2026-10-19"); // 10:30pm Fri ET -> Monday
    expect(addBusinessDays(at("2026-10-16T17:00:00Z"), 0)).toBe("2026-10-16");
  });
  it("rejects invalid counts", () => {
    expect(() => addBusinessDays(new Date(), -1)).toThrow();
    expect(() => addBusinessDays(new Date(), 1.5)).toThrow();
  });
});

describe("receiver deposit options", () => {
  const now = at("2026-10-14T16:00:00Z");

  it("when the sender paid, instant is free for the receiver and waiting refunds the sender", () => {
    const o = depositOptionsFor({ amountMinor: 156_090n, currency: "USD", senderPaidInstantFeeMinor: 2_888n, now });
    expect(o.instant).toMatchObject({ available: true, receiverFeeMinor: 0n, feePaidBy: "sender", netDepositMinor: 156_090n });
    expect(o.standard).toMatchObject({ receiverFeeMinor: 0n, netDepositMinor: 156_090n, businessDays: 3, availableOn: "2026-10-19", senderFeeRefundMinor: 2_888n });
  });

  it("when the sender skipped the fee, instant costs the receiver the instant fee and waiting is free", () => {
    const o = depositOptionsFor({ amountMinor: 156_090n, currency: "USD", senderPaidInstantFeeMinor: 0n, now });
    expect(o.instant).toMatchObject({ available: true, receiverFeeMinor: 2_888n, feePaidBy: "receiver", netDepositMinor: 153_202n });
    expect(o.standard).toMatchObject({ receiverFeeMinor: 0n, netDepositMinor: 156_090n, senderFeeRefundMinor: 0n });
  });

  it("applies the 0.30 minimum and refuses instant when the amount does not exceed the fee", () => {
    expect(depositOptionsFor({ amountMinor: 100n, currency: "USD", senderPaidInstantFeeMinor: 0n, now }).instant).toMatchObject({ available: true, receiverFeeMinor: 30n, netDepositMinor: 70n });
    expect(depositOptionsFor({ amountMinor: 30n, currency: "USD", senderPaidInstantFeeMinor: 0n, now }).instant).toMatchObject({ available: false, unavailableReason: "AMOUNT_NOT_ABOVE_FEE", netDepositMinor: 0n });
  });
});
