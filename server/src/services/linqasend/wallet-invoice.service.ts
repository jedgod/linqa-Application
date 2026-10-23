import { createHash, randomBytes } from 'node:crypto';
import type { SqlClient } from '../../db/migration-runner.js';
import { scheduledFee } from './wallet-fee-schedule.js';
import { WalletAvailabilityService } from './wallet-availability.service.js';

export const INVOICE_CODE = /^inv_[A-Za-z0-9]{6,64}$/;
export const MIN_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 3600;
/** A merchant can hold this many unexpired, unpaid invoices at once. */
export const MAX_OPEN_INVOICES = 20;

export type WalletInvoiceView = { id: string; code: string; merchantName: string; baseAmountMinor: string; currency: string; expiresAt: string };

export const hashInvoiceCode = (code: string) => createHash('sha256').update(code).digest('hex');
/** "inv_1a2...9f3c": enough to recognise a code in support or a receipt without being able to use it. */
export const invoiceCodeHint = (code: string) => `${code.slice(0, 7)}...${code.slice(-4)}`;

/** The one definition of a payable invoice, used by look-up and by the money core. Throws the stable code the app maps to a message. */
export function assertInvoicePayable(row: { status: string; expires_at: Date | string; merchant_user_id: string } | undefined, payerUserId: string): void {
  if (!row || row.status === 'CANCELED') throw new Error('INVOICE_NOT_FOUND');
  if (row.status === 'PAID') throw new Error('INVOICE_ALREADY_PAID');
  if (row.status !== 'OPEN' || new Date(row.expires_at).getTime() <= Date.now()) throw new Error('INVOICE_EXPIRED');
  if (row.merchant_user_id === payerUserId) throw new Error('INVOICE_OWN');
}

/**
 * One-time invoices that pay into the requester's own wallet (LinqaStealthPay). The code is a bearer token: only its
 * SHA-256 is stored, and the plain code is returned once, at creation. This service creates and resolves invoices; it never
 * moves money. Paying is a wallet transfer that goes through the audited quote, biometric and hold path.
 */
export class WalletInvoiceService {
  constructor(private readonly db: SqlClient) {}

  async create(userId: string, input: { currency: string; amountMinor: string; ttlSeconds: number }): Promise<WalletInvoiceView> {
    const wallet = (await this.db.query(
      `SELECT id, regulatory_entity_id, jurisdiction FROM linqasend_wallet_accounts_v2
        WHERE user_id=$1 AND currency=$2 AND status='ACTIVE' AND subledger_enabled`, [userId, input.currency])).rows[0];
    if (!wallet) throw new Error('WALLET_NOT_ACTIVE');
    await new WalletAvailabilityService(this.db).assertServed(this.db, wallet.jurisdiction, input.currency);
    // An invoice nobody can be priced for would be unpayable, so refuse it up front.
    if (scheduledFee('INTERNAL', input.currency, input.amountMinor) === null) throw new Error('WALLET_FEE_SCHEDULE_MISSING');
    const open = Number((await this.db.query(
      `SELECT count(*) AS n FROM linqasend_wallet_invoices WHERE merchant_user_id=$1 AND status='OPEN' AND expires_at>now()`, [userId])).rows[0].n);
    if (open >= MAX_OPEN_INVOICES) throw new Error('INVOICE_LIMIT_REACHED');

    const code = `inv_${randomBytes(16).toString('hex')}`;
    const row = (await this.db.query(
      `INSERT INTO linqasend_wallet_invoices(code_hash, code_hint, merchant_user_id, merchant_wallet_id, regulatory_entity_id, currency, amount_minor, expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8)) RETURNING id, expires_at`,
      [hashInvoiceCode(code), invoiceCodeHint(code), userId, wallet.id, wallet.regulatory_entity_id, input.currency, input.amountMinor, input.ttlSeconds])).rows[0];
    return { id: row.id, code, merchantName: 'You', baseAmountMinor: input.amountMinor, currency: input.currency, expiresAt: new Date(row.expires_at).toISOString() };
  }

  /** Resolves a code for someone who is about to pay it. Errors are stable codes the app maps to messages. */
  async lookup(payerUserId: string, code: string): Promise<WalletInvoiceView> {
    if (!INVOICE_CODE.test(code)) throw new Error('INVOICE_NOT_FOUND');
    const row = (await this.db.query(
      `SELECT id, merchant_user_id, currency, amount_minor, status, expires_at
         FROM linqasend_wallet_invoices WHERE code_hash=$1`, [hashInvoiceCode(code)])).rows[0];
    assertInvoicePayable(row, payerUserId);
    return { id: row.id, code, merchantName: 'Linqa user', baseAmountMinor: String(row.amount_minor), currency: String(row.currency).trim(), expiresAt: new Date(row.expires_at).toISOString() };
  }
}

/** Status for each error the invoice routes can return. Anything else is an internal error, never shown as a cause. */
export const INVOICE_ERROR_STATUS: Record<string, number> = {
  INVOICE_NOT_FOUND: 404, INVOICE_ALREADY_PAID: 409, INVOICE_EXPIRED: 409, INVOICE_OWN: 409, INVOICE_LIMIT_REACHED: 429,
  WALLET_NOT_ACTIVE: 409, WALLET_CURRENCY_NOT_AVAILABLE: 409, WALLET_FEE_SCHEDULE_MISSING: 409
};
