import { randomUUID } from "node:crypto";
import type { Database } from "../../db/pool.js";
import { FxPricingService } from "./fx-pricing.service.js";
import { FxRateRepository } from "./fx-rate.repository.js";

const QUOTE_TTL_SECONDS = 30;

export interface Corridor {
  id: string;
  source_country: string;
  destination_country: string;
  source_currency: string;
  destination_currency: string;
  min_amount_minor: string;
  max_amount_minor: string;
  base_margin_bps: number;
  min_margin_bps: number;
  max_margin_bps: number;
  volatility_buffer_bps: number;
  settlement_buffer_bps: number;
  liquidity_buffer_bps: number;
  provider: string;
  active: boolean;
}

export class QuoteService {
  constructor(
    private readonly db: Database,
    private readonly fxPricing: FxPricingService,
    private readonly fxRates: FxRateRepository
  ) {}

  async findCorridor(sourceCountry: string, destinationCountry: string, sourceCurrency: string, destinationCurrency: string) {
    const { rows } = await this.db.query<Corridor>(
      `SELECT * FROM linqasend_corridors
       WHERE source_country = $1 AND destination_country = $2
         AND source_currency = $3 AND destination_currency = $4
         AND active = TRUE
       LIMIT 1`,
      [sourceCountry, destinationCountry, sourceCurrency, destinationCurrency]
    );
    if (!rows[0]) throw new Error("CORRIDOR_NOT_AVAILABLE");
    return rows[0];
  }

  async createQuote(input: {
    userId: string;
    recipientId: string;
    corridor: Corridor;
    paymentMethodId?: string | undefined;
    sendAmountMinor: bigint;
  }) {
    const c = input.corridor;
    if (input.sendAmountMinor < BigInt(c.min_amount_minor) || input.sendAmountMinor > BigInt(c.max_amount_minor)) {
      throw new Error("AMOUNT_OUTSIDE_CORRIDOR_LIMITS");
    }

    const rate = await this.fxRates.latest(c.source_currency, c.destination_currency);

    const price = this.fxPricing.createPrice({
      sendAmountMinor: input.sendAmountMinor,
      marketRate: rate.marketRate,
      providerExecutionRate: rate.executionRate,
      rule: {
        baseMarginBps: c.base_margin_bps,
        minMarginBps: c.min_margin_bps,
        maxMarginBps: c.max_margin_bps,
        volatilityBufferBps: c.volatility_buffer_bps,
        settlementBufferBps: c.settlement_buffer_bps,
        liquidityBufferBps: c.liquidity_buffer_bps
      }
    });

    const quoteExpiry = new Date(Math.min(rate.validUntil.getTime(), Date.now() + QUOTE_TTL_SECONDS * 1000));
    const id = randomUUID();

    await this.db.query(
      `INSERT INTO linqasend_quotes(
         id, user_id, recipient_id, corridor_id, payment_method_id,
         send_amount_minor, send_currency, receive_amount_minor, receive_currency,
         market_reference_rate, provider_execution_rate, customer_rate, margin_bps,
         sender_fee_minor, recipient_fee_minor, status, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE',$16)`,
      [
        id,
        input.userId,
        input.recipientId,
        c.id,
        input.paymentMethodId ?? null,
        input.sendAmountMinor.toString(),
        c.source_currency,
        price.receiveAmountMinor.toString(),
        c.destination_currency,
        rate.marketRate,
        rate.executionRate,
        price.customerRate,
        price.marginBps,
        price.senderFeeMinor.toString(),
        price.recipientFeeMinor.toString(),
        quoteExpiry
      ]
    );

    return {
      id,
      recipientId: input.recipientId,
      corridorId: c.id,
      sendAmountMinor: input.sendAmountMinor.toString(),
      sendCurrency: c.source_currency,
      receiveAmountMinor: price.receiveAmountMinor.toString(),
      receiveCurrency: c.destination_currency,
      marketReferenceRate: rate.marketRate,
      providerExecutionRate: rate.executionRate,
      customerRate: price.customerRate,
      marginBps: price.marginBps,
      senderFeeMinor: "0",
      recipientFeeMinor: "0",
      provider: c.provider,
      expiresAt: quoteExpiry.toISOString()
    };
  }

  async getActiveQuote(userId: string, quoteId: string) {
    const { rows } = await this.db.query(
      `SELECT q.*, c.provider FROM linqasend_quotes q
       JOIN linqasend_corridors c ON c.id = q.corridor_id
       WHERE q.id = $1 AND q.user_id = $2`,
      [quoteId, userId]
    );
    const row = rows[0];
    if (!row) throw new Error("QUOTE_NOT_FOUND");
    if (row.status !== "ACTIVE") throw new Error("QUOTE_NOT_ACTIVE");
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("QUOTE_EXPIRED");
    return row;
  }
}
