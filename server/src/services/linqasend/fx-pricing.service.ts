import { applyMarginToScaledRate, clampMarginBps, convertMinor, parseRateToScaled, scaledRateToString } from "./money.js";

export interface CorridorPricingRule {
  baseMarginBps: number;
  minMarginBps: number;
  maxMarginBps: number;
  volatilityBufferBps: number;
  settlementBufferBps: number;
  liquidityBufferBps: number;
}

/**
 * Ported from LinqaSend's `fx-pricing.service.ts`: revenue comes from a
 * disclosed FX spread applied on top of the provider's execution rate, not
 * from sender/recipient fees (both stay 0 by design — see the pack's
 * implementation notes). The math itself needs no live provider to be
 * correct; only the *rate it's applied to* requires one (see
 * `providers.ts`).
 */
export class FxPricingService {
  calculateMargin(rule: CorridorPricingRule): number {
    const raw =
      rule.baseMarginBps + rule.volatilityBufferBps + rule.settlementBufferBps + rule.liquidityBufferBps;
    return clampMarginBps(raw, rule.minMarginBps, rule.maxMarginBps);
  }

  createPrice(input: {
    sendAmountMinor: bigint;
    marketRate: string;
    providerExecutionRate: string;
    rule: CorridorPricingRule;
  }) {
    if (input.sendAmountMinor <= 0n) throw new Error("INVALID_SEND_AMOUNT");

    const marginBps = this.calculateMargin(input.rule);
    const scaledExecutionRate = parseRateToScaled(input.providerExecutionRate);
    const scaledCustomerRate = applyMarginToScaledRate(scaledExecutionRate, marginBps);
    if (scaledCustomerRate <= 0n) throw new Error("INVALID_CUSTOMER_RATE");

    const receiveAmountMinor = convertMinor(input.sendAmountMinor, scaledCustomerRate);
    const providerReceiveMinor = convertMinor(input.sendAmountMinor, scaledExecutionRate);
    const marketReceiveMinor = convertMinor(input.sendAmountMinor, parseRateToScaled(input.marketRate));

    return {
      marginBps,
      customerRate: scaledRateToString(scaledCustomerRate),
      receiveAmountMinor,
      senderFeeMinor: 0n,
      recipientFeeMinor: 0n,
      // Destination-currency spread; finance converts to reporting currency separately.
      grossFxSpreadMinor: providerReceiveMinor - receiveAmountMinor,
      marketVsProviderCostMinor: marketReceiveMinor - providerReceiveMinor
    };
  }
}
