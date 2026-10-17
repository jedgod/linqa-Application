import { calculateSenderFeeMinor } from "./fee-calculation.js";
import { addBusinessDays } from "./business-days.js";

export type DepositOption = "instant" | "standard";
export const STANDARD_DEPOSIT_BUSINESS_DAYS = 3;

export type DepositOptions = {
  instant: {
    available: boolean;
    /** Charged to the receiver and taken out of the deposit. 0 when the sender already paid the instant fee. */
    receiverFeeMinor: bigint;
    feePaidBy: "sender" | "receiver";
    netDepositMinor: bigint;
    unavailableReason?: "AMOUNT_NOT_ABOVE_FEE";
  };
  standard: {
    receiverFeeMinor: 0n;
    netDepositMinor: bigint;
    businessDays: number;
    /** US Eastern calendar date (YYYY-MM-DD) from which the deposit is released. */
    availableOn: string;
    /** If the sender paid the instant fee and the receiver waits instead, that fee goes back to the sender. */
    senderFeeRefundMinor: bigint;
  };
};

/**
 * The receiver's choice for moving received money from their wallet to a bank or card on file.
 * - Sender paid the instant fee: instant costs the receiver nothing; waiting 3 business days is free and refunds the sender.
 * - Sender skipped the fee: waiting 3 business days is free; instant costs the receiver the instant fee, taken from the deposit.
 */
export function depositOptionsFor(input: { amountMinor: bigint; currency: string; senderPaidInstantFeeMinor: bigint; now?: Date }): DepositOptions {
  const now = input.now ?? new Date();
  const senderPaid = input.senderPaidInstantFeeMinor > 0n;
  const receiverFeeMinor = senderPaid ? 0n : calculateSenderFeeMinor(input.amountMinor, input.currency, "instant");
  const net = input.amountMinor - receiverFeeMinor;
  return {
    instant: {
      available: net > 0n,
      receiverFeeMinor,
      feePaidBy: senderPaid ? "sender" : "receiver",
      netDepositMinor: net > 0n ? net : 0n,
      ...(net > 0n ? {} : { unavailableReason: "AMOUNT_NOT_ABOVE_FEE" as const })
    },
    standard: {
      receiverFeeMinor: 0n,
      netDepositMinor: input.amountMinor,
      businessDays: STANDARD_DEPOSIT_BUSINESS_DAYS,
      availableOn: addBusinessDays(now, STANDARD_DEPOSIT_BUSINESS_DAYS),
      senderFeeRefundMinor: input.senderPaidInstantFeeMinor
    }
  };
}
