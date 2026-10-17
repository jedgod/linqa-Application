import { describe, expect, it } from "vitest";
import { DepositError, DepositService } from "../services/linqasend/deposit.service.js";

type Call = { sql: string; params: any[] };

/** Scripted database: answers by the statement's shape and records every call. */
function fakeDb(opts: { transfer?: any | null; destination?: any | null; insertWins?: boolean; existing?: any | null; claimed?: any[] }) {
  const calls: Call[] = [];
  const transfer = opts.transfer === undefined ? { id: "t-1", public_id: "T-PUBLIC", status: "COMPLETED", receive_amount_minor: "156090", receive_currency: "USD", sender_fee_minor: "0" } : opts.transfer;
  const destination = opts.destination === undefined ? { provider_payment_method_ref: "vault:bank" } : opts.destination;
  return {
    calls,
    async query(sql: string, params: any[] = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM linqasend_transfers t") && sql.includes("JOIN linqasend_quotes")) return { rows: transfer ? [transfer] : [] };
      if (sql.includes("FROM linqasend_payment_methods")) return { rows: destination ? [destination] : [] };
      if (sql.includes("INSERT INTO linqasend_deposit_requests")) return { rows: opts.insertWins === false ? [] : [{ id: params[0] }] };
      if (sql.includes("SELECT option,status")) return { rows: opts.existing ? [opts.existing] : [] };
      if (sql.includes("SET status='PROCESSING'")) return { rows: opts.claimed ?? [] };
      return { rows: [] };
    }
  } as any;
}

function payoutStub(result: "COMPLETED" | "PROCESSING" | "FAILED" | "THROW" = "COMPLETED") {
  const created: any[] = [];
  return {
    created,
    provider: {
      name: "stub",
      async createPayout(input: any) { created.push(input); if (result === "THROW") throw new Error("boom"); return { status: result, providerRef: "po_1" }; },
      async lookup() { return null; }
    }
  };
}

const NOW = new Date("2026-10-14T16:00:00Z");
const withSenderFee = { id: "t-1", public_id: "T-PUBLIC", status: "COMPLETED", receive_amount_minor: "156090", receive_currency: "USD", sender_fee_minor: "2888" };

describe("deposit service", () => {
  it("shows who pays for instant and when the free option releases", async () => {
    const service = new DepositService(fakeDb({ transfer: withSenderFee }), payoutStub().provider);
    const result = await service.options("u-receiver", "T-PUBLIC", NOW);
    expect(result.senderPaidInstantFee).toBe(true);
    expect(result.options.instant).toMatchObject({ receiverFeeMinor: 0n, feePaidBy: "sender" });
    expect(result.options.standard).toMatchObject({ availableOn: "2026-10-19", senderFeeRefundMinor: 2888n });
    expect(result.chosen).toBeNull();
  });

  it("instant when the sender skipped the fee: pays out the amount minus the receiver's fee", async () => {
    const payout = payoutStub();
    const service = new DepositService(fakeDb({}), payout.provider);
    const out = await service.request({ userId: "u-receiver", publicId: "T-PUBLIC", option: "instant", paymentMethodId: "pm-bank", now: NOW });
    expect(out).toMatchObject({ status: "COMPLETED", receiverFeeMinor: 2888n, netDepositMinor: 153202n });
    expect(payout.created).toHaveLength(1);
    expect(payout.created[0]).toMatchObject({ amountMinor: 153202n, currency: "USD", recipientProviderRef: "vault:bank" });
    expect(payout.created[0].idempotencyKey).toMatch(/^deposit:/);
  });

  it("instant when the sender paid: the receiver pays nothing and gets the full amount", async () => {
    const payout = payoutStub();
    const out = await new DepositService(fakeDb({ transfer: withSenderFee }), payout.provider).request({ userId: "u", publicId: "T-PUBLIC", option: "instant", paymentMethodId: "pm", now: NOW });
    expect(out).toMatchObject({ receiverFeeMinor: 0n, netDepositMinor: 156090n });
    expect(payout.created[0].amountMinor).toBe(156090n);
  });

  it("standard schedules the deposit for 3 business days, pays nothing now, and refunds a sender who paid", async () => {
    const payout = payoutStub();
    const db = fakeDb({ transfer: withSenderFee });
    const out = await new DepositService(db, payout.provider).request({ userId: "u", publicId: "T-PUBLIC", option: "standard", paymentMethodId: "pm", now: NOW });
    expect(out).toMatchObject({ status: "SCHEDULED", releaseOn: "2026-10-19", netDepositMinor: 156090n, senderFeeRefundMinor: 2888n });
    expect(payout.created).toHaveLength(0);
    const insert = db.calls.find((c: Call) => c.sql.includes("INSERT INTO linqasend_deposit_requests"))!;
    expect(insert.params).toContain("PENDING_REFUND");
    expect(insert.params).toContain("SCHEDULED");
  });

  it("refuses non-receivers, unfinished transfers, bad destinations, repeat choices and tiny instant amounts", async () => {
    const stub = payoutStub().provider;
    await expect(new DepositService(fakeDb({ transfer: null }), stub).request({ userId: "u", publicId: "x", option: "standard", paymentMethodId: "pm" })).rejects.toMatchObject({ code: "transfer_not_found" });
    await expect(new DepositService(fakeDb({ transfer: { ...withSenderFee, status: "DECLINED" } }), stub).request({ userId: "u", publicId: "x", option: "standard", paymentMethodId: "pm" })).rejects.toMatchObject({ code: "transfer_not_completed" });
    await expect(new DepositService(fakeDb({ destination: null }), stub).request({ userId: "u", publicId: "x", option: "standard", paymentMethodId: "pm" })).rejects.toMatchObject({ code: "deposit_destination_required" });
    await expect(new DepositService(fakeDb({ insertWins: false }), stub).request({ userId: "u", publicId: "x", option: "standard", paymentMethodId: "pm" })).rejects.toMatchObject({ code: "deposit_already_chosen" });
    await expect(new DepositService(fakeDb({ transfer: { ...withSenderFee, receive_amount_minor: "30", sender_fee_minor: "0" } }), stub).request({ userId: "u", publicId: "x", option: "instant", paymentMethodId: "pm" })).rejects.toMatchObject({ code: "instant_deposit_unavailable" });
  });

  it("marks the deposit failed when the payout fails or errors", async () => {
    for (const result of ["FAILED", "THROW"] as const) {
      const db = fakeDb({});
      await expect(new DepositService(db, payoutStub(result).provider).request({ userId: "u", publicId: "x", option: "instant", paymentMethodId: "pm", now: NOW })).rejects.toBeInstanceOf(DepositError);
      expect(db.calls.some((c: Call) => c.sql.includes("UPDATE linqasend_deposit_requests") && JSON.stringify(c.params).includes("FAILED") || c.sql.includes("status='FAILED'"))).toBe(true);
    }
  });

  it("releases due scheduled deposits through the payout provider", async () => {
    const payout = payoutStub();
    const db = fakeDb({ claimed: [{ id: "d-1", public_id: "T-1", provider_payment_method_ref: "vault:bank", net_deposit_minor: "156090", currency: "USD" }] });
    expect(await new DepositService(db, payout.provider).releaseDue(new Date("2026-10-19T16:00:00Z"))).toBe(1);
    expect(payout.created[0]).toMatchObject({ amountMinor: 156090n, idempotencyKey: "deposit:d-1" });
    expect(db.calls[0].params[0]).toBe("2026-10-19");
  });
});
