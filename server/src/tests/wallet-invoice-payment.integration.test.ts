import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { WalletMoneyService } from '../services/linqasend/wallet-money.service.js';
import { WalletLedgerService } from '../services/linqasend/wallet-ledger.service.js';
import { WalletInvoiceService } from '../services/linqasend/wallet-invoice.service.js';
import type { WalletMoneyPolicy } from '../services/linqasend/wallet-money-policy.js';

/**
 * Paying a one-time invoice through the audited money core.
 *
 * LINQA_WALLET_DISPOSABLE_TEST_DB=1 runs against a disposable database, including the concurrency case.
 * LINQA_INVOICE_TEST_ROLLBACK=1 runs the sequential cases on one connection inside a transaction that is always rolled
 * back, so a database where CREATE DATABASE is not permitted is left untouched. Transactions the service opens become savepoints.
 */
const disposable = process.env.LINQA_WALLET_DISPOSABLE_TEST_DB === '1';
const rollback = !disposable && process.env.LINQA_INVOICE_TEST_ROLLBACK === '1';
const suite = disposable || rollback ? describe : describe.skip;

suite('invoice payment settles and marks the invoice paid in one transaction', () => {
  let db: any, ledger: WalletLedgerService, invoices: WalletInvoiceService, service: WalletMoneyService, root: pg.Client | undefined;
  const allow: WalletMoneyPolicy = { authorize: async () => {}, resolve: async (r) => r };
  const authorize = async () => {};

  beforeAll(async () => {
    if (rollback) {
      root = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await root.connect();
      await root.query('BEGIN');
      const saves: string[] = [];
      let n = 0;
      const run = async (text: any, values?: any) => {
        const sql = typeof text === 'string' ? text.trim().toUpperCase() : '';
        if (sql === 'BEGIN') { const name = `sp_${++n}`; saves.push(name); return root!.query(`SAVEPOINT ${name}`); }
        if (sql === 'COMMIT') return root!.query(`RELEASE SAVEPOINT ${saves.pop()}`);
        if (sql === 'ROLLBACK') { const name = saves.pop(); await root!.query(`ROLLBACK TO SAVEPOINT ${name}`); return root!.query(`RELEASE SAVEPOINT ${name}`); }
        return root!.query(text, values);
      };
      db = { query: run, connect: async () => ({ query: run, release() {} }), end: async () => {} };
    } else {
      db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
    }
    ledger = new WalletLedgerService(db);
    invoices = new WalletInvoiceService(db);
    service = new WalletMoneyService(db, undefined, allow);
    await db.query(`INSERT INTO linqasend_financial_entities_v7(id,legal_name,display_name,entity_type,country_code,status,due_diligence_status,operational_status) VALUES('invoice-pay','t','t','BANK','US','ACTIVE','APPROVED','HEALTHY') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO linqasend_provider_custody_accounts(provider_id,regulatory_entity_id,currency,provider_account_ref,active) VALUES('invoice-pay-provider','invoice-pay','USD','test-account',true) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO linqasend_corridors(source_country,destination_country,source_currency,destination_currency,min_amount_minor,max_amount_minor,base_margin_bps,min_margin_bps,max_margin_bps,provider) VALUES('US','US','USD','USD',100,100000000,0,0,0,'invoice-pay-provider') ON CONFLICT DO NOTHING`);
  });
  afterAll(async () => {
    if (root) { await root.query('ROLLBACK'); await root.end(); } else await db?.end();
  });

  async function tx<T>(fn: (c: any) => Promise<T>) { const c = await db.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
  async function person(initial = '0') {
    const user = randomUUID(), wallet = randomUUID();
    await db.query(`INSERT INTO users(id,external_subject,status) VALUES($1::uuid,$1::text,'ACTIVE')`, [user]);
    await db.query(`INSERT INTO user_jurisdiction_profiles_v2(user_id,original_registration_country,verified_residence_country,account_country,regulatory_entity_id,regulatory_jurisdiction) VALUES($1,'US','US','US','invoice-pay','US')`, [user]);
    await db.query(`INSERT INTO linqasend_wallet_accounts_v2(id,user_id,jurisdiction,regulatory_entity_id,currency,jurisdiction_version,subledger_enabled) VALUES($1,$2,'US','invoice-pay','USD',1,true)`, [wallet, user]);
    if (BigInt(initial) > 0n) await tx((c) => ledger.post(c, { ref: `fixture:${wallet}`, kind: 'RECEIPT', currency: 'USD', legs: [{ walletId: wallet, bucket: 'AVAILABLE', amount: BigInt(initial) }, { bucket: 'CUSTODY_CLEARING', amount: -BigInt(initial) }] }));
    return { user, wallet };
  }
  const balance = async (user: string) => (await ledger.summary(user)).items[0]!;
  const invoiceRow = async (id: string) => (await db.query(`SELECT status,paid_operation_id,paid_at FROM linqasend_wallet_invoices WHERE id=$1`, [id])).rows[0];
  const operations = async (user: string) => Number((await db.query(`SELECT count(*) n FROM linqasend_wallet_money_operations WHERE user_id=$1`, [user])).rows[0].n);
  const fails = async (p: () => Promise<unknown>) => { try { await p(); return ''; } catch (e) { return (e as Error).message; } };
  const issue = (merchant: { user: string }, amount = '2450', ttlSeconds = 900) => invoices.create(merchant.user, { currency: 'USD', amountMinor: amount, ttlSeconds });

  it('moves the base amount to the invoice wallet, charges the fee on top, and marks the invoice paid', async () => {
    const merchant = await person(), payer = await person('10000'), inv = await issue(merchant);
    const q = await service.quoteInvoice(payer.user, inv.id);
    expect(q).toMatchObject({ kind: 'INTERNAL', amountMinor: '2450', feeMinor: '245', totalMinor: '2695', currency: 'USD', invoiceId: inv.id, targetWalletId: merchant.wallet });
    expect(Date.parse(q.expiresAt)).toBeLessThanOrEqual(Date.parse(inv.expiresAt));

    expect(await service.submit(payer.user, q.id, authorize)).toMatchObject({ id: q.id, status: 'COMPLETED' });
    expect(await balance(payer.user)).toMatchObject({ availableMinor: '7305', heldMinor: '0' });
    expect(await balance(merchant.user)).toMatchObject({ availableMinor: '2450' });
    const paid = await invoiceRow(inv.id);
    expect(paid).toMatchObject({ status: 'PAID', paid_operation_id: q.id });
    expect(paid.paid_at).not.toBeNull();
    const journal = await db.query(`SELECT sum(amount_minor)::text AS n FROM linqasend_wallet_postings WHERE journal_id=(SELECT id FROM linqasend_wallet_journals WHERE external_ref=$1)`, [`money:${q.id}:settled`]);
    expect(journal.rows[0].n).toBe('0');
  });

  it('is idempotent for the payer: resubmitting the same quote does not pay twice', async () => {
    const merchant = await person(), payer = await person('10000'), inv = await issue(merchant);
    const q = await service.quoteInvoice(payer.user, inv.id);
    await service.submit(payer.user, q.id, authorize);
    expect(await service.submit(payer.user, q.id, async () => { throw new Error('must not reauthorize'); })).toMatchObject({ id: q.id, status: 'COMPLETED' });
    expect(await balance(merchant.user)).toMatchObject({ availableMinor: '2450' });
  });

  it('lets only one of two payers with a live quote pay, and leaves the other untouched', async () => {
    const merchant = await person(), a = await person('10000'), b = await person('10000'), inv = await issue(merchant);
    const qa = await service.quoteInvoice(a.user, inv.id), qb = await service.quoteInvoice(b.user, inv.id);
    await service.submit(a.user, qa.id, authorize);
    expect(await fails(() => service.submit(b.user, qb.id, authorize))).toBe('INVOICE_ALREADY_PAID');
    expect(await balance(b.user)).toMatchObject({ availableMinor: '10000', heldMinor: '0' });
    expect(await operations(b.user)).toBe(0);
    expect(await balance(merchant.user)).toMatchObject({ availableMinor: '2450' });
    expect(await invoiceRow(inv.id)).toMatchObject({ paid_operation_id: qa.id });
  });

  it.skipIf(rollback)('serializes two payers submitting at the same moment', async () => {
    const merchant = await person(), a = await person('10000'), b = await person('10000'), inv = await issue(merchant);
    const qa = await service.quoteInvoice(a.user, inv.id), qb = await service.quoteInvoice(b.user, inv.id);
    const results = await Promise.allSettled([service.submit(a.user, qa.id, authorize), service.submit(b.user, qb.id, authorize)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(merchant.user)).toMatchObject({ availableMinor: '2450' });
    const charged = [await balance(a.user), await balance(b.user)].filter((x) => x.availableMinor === '7305');
    expect(charged).toHaveLength(1);
  });

  it('refuses a payer with insufficient funds and leaves the invoice open', async () => {
    const merchant = await person(), payer = await person('2000'), inv = await issue(merchant);
    const q = await service.quoteInvoice(payer.user, inv.id);
    expect(await fails(() => service.submit(payer.user, q.id, authorize))).not.toBe('');
    expect(await invoiceRow(inv.id)).toMatchObject({ status: 'OPEN', paid_operation_id: null });
    expect(await balance(payer.user)).toMatchObject({ availableMinor: '2000', heldMinor: '0' });
    expect(await operations(payer.user)).toBe(0);
  });

  it('rolls everything back when biometric authorization fails', async () => {
    const merchant = await person(), payer = await person('10000'), inv = await issue(merchant);
    const q = await service.quoteInvoice(payer.user, inv.id);
    expect(await fails(() => service.submit(payer.user, q.id, async () => { throw new Error('BIOMETRIC_DENIED'); }))).toBe('BIOMETRIC_DENIED');
    expect(await invoiceRow(inv.id)).toMatchObject({ status: 'OPEN' });
    expect(await balance(payer.user)).toMatchObject({ availableMinor: '10000', heldMinor: '0' });
    expect(await operations(payer.user)).toBe(0);
  });

  it('refuses to settle an invoice canceled after the quote was made', async () => {
    const merchant = await person(), payer = await person('10000'), inv = await issue(merchant);
    const q = await service.quoteInvoice(payer.user, inv.id);
    await db.query(`UPDATE linqasend_wallet_invoices SET status='CANCELED' WHERE id=$1`, [inv.id]);
    expect(await fails(() => service.submit(payer.user, q.id, authorize))).toBe('INVOICE_NOT_FOUND');
    expect(await balance(payer.user)).toMatchObject({ availableMinor: '10000', heldMinor: '0' });
    expect(await balance(merchant.user)).toMatchObject({ availableMinor: '0' });
  });

  it('refuses your own invoice, an expired one, and one already paid', async () => {
    const merchant = await person('10000'), payer = await person('10000');
    expect(await fails(async () => service.quoteInvoice(merchant.user, (await issue(merchant)).id))).toBe('INVOICE_OWN');

    const stale = (await db.query(
      `INSERT INTO linqasend_wallet_invoices(code_hash,code_hint,merchant_user_id,merchant_wallet_id,regulatory_entity_id,currency,amount_minor,expires_at,created_at)
       VALUES(encode(sha256(gen_random_uuid()::text::bytea),'hex'),'inv_old...0000',$1,$2,'invoice-pay','USD',2450,now()-interval '1 hour',now()-interval '2 hours') RETURNING id`, [merchant.user, merchant.wallet])).rows[0];
    expect(await fails(() => service.quoteInvoice(payer.user, stale.id))).toBe('INVOICE_EXPIRED');

    const inv = await issue(merchant), q = await service.quoteInvoice(payer.user, inv.id);
    await service.submit(payer.user, q.id, authorize);
    expect(await fails(() => service.quoteInvoice(payer.user, inv.id))).toBe('INVOICE_ALREADY_PAID');
  });

  it('keeps ordinary quotes free of an invoice id', async () => {
    const payer = await person('10000');
    const q = await service.quoteInvoice(payer.user, (await issue(await person())).id);
    expect(Object.keys(q)).toContain('invoiceId');
    expect(await fails(() => service.quoteInvoice(payer.user, randomUUID()))).toBe('INVOICE_NOT_FOUND');
  });
});
