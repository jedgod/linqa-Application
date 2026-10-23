import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { SqlClient } from '../../db/migration-runner.js';
import type { AuthPrincipal } from '../../auth/types.js';
import { createPaymentAuthenticator } from '../../auth/payment-authenticator.js';
import { getLinqaSendProviders } from '../../integrations/linqasend/provider.registry.js';

// The same ownership predicate as WalletMoneyService.list, including internal receipts.
const OWNED = `(user_id=$1 OR kind='INTERNAL' AND snapshot->>'targetWalletId' IN
  (SELECT id::text FROM linqasend_wallet_accounts_v2 WHERE user_id=$1))`;
export function reportPeriod(value: unknown) {
  const period = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/).parse(value);
  const [year, month] = period.split('-').map(Number);
  return { period, start: new Date(Date.UTC(year!, month! - 1, 1)).toISOString(), end: new Date(Date.UTC(year!, month!, 1)).toISOString() };
}
export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
}

export async function registerWalletMoreRoutes(app: FastifyInstance, config: AppConfig, db: SqlClient,
  auth: (r: FastifyRequest) => Promise<AuthPrincipal> = createPaymentAuthenticator(config, db),
  linkingConfigured = !!getLinqaSendProviders().walletMoney) {
  const secured = (work: (r: FastifyRequest, p: AuthPrincipal) => Promise<unknown>) => async (r: FastifyRequest, reply: import('fastify').FastifyReply) => {
    let p: AuthPrincipal;
    try { p = await auth(r); } catch { return reply.code(401).send({ error: 'unauthorized' }); }
    if (!p.scopes.has('linqasend:read')) return reply.code(403).send({ error: 'wallet_read_required' });
    reply.header('cache-control', 'no-store');
    try { return await work(r, p); }
    catch (e) {
      if (e instanceof z.ZodError) return reply.code(422).send({ error: 'invalid_report_period' });
      r.log.error({ err: e }, 'wallet services unavailable');
      return reply.code(503).send({ error: 'wallet_services_unavailable' });
    }
  };
  app.get('/v2/wallet/services', secured(async (_r, p) => ({
    services: ['funding-methods', 'currencies', 'limits', 'reports', 'cards', 'security', 'support', 'stealthpay'],
    linkMethodSupported: p.scopes.has('linqasend:write') && linkingConfigured
      && !!config.LINQASEND_TOKEN_KMS_KEY_ID && !!config.LINQASEND_TOKEN_KMS_REGION,
    displayCurrencySupported: false,
    cardsRoute: '/linqasend/payment-methods',
    biometricAuthorizationRequired: true,
    securityOptions: [
      { title: 'Privacy center', description: 'Review privacy controls and device alerts.', route: '/privacy-center' },
      { title: 'Privacy rights', description: 'Review your data and privacy options.', route: '/settings/privacy-rights' }
    ].filter(option => option.route === '/privacy-center' ? p.scopes.has('privacy:read') : p.scopes.has('account:write')),
    permissions: [...p.scopes].filter(s => s === 'linqasend:read' || s === 'linqasend:write'),
    supportTopics: [
      { title: 'Funding and withdrawals', body: 'Link a bank account or debit card using secure provider setup. Wallet activity shows the status returned by the service. A pending payment is not settled money.' },
      { title: 'Transfers and limits', body: 'Limits and eligible destinations depend on your verified account and the current route. Review the amount, fees and recipient before authorizing.' },
      { title: 'Wallets and currencies', body: 'Wallet eligibility comes from your verified account country. Travelling does not change your residence or create another wallet.' },
      { title: 'Reports', body: 'Monthly transaction reports include wallet operations recorded during the selected UTC calendar month. They are activity reports, not certified balance statements.' }
    ],
    supportRoute: '/support'
  })));
  app.get('/v2/wallet/funding-methods', secured(async (_r, p) => {
    const { rows } = await db.query(`SELECT id,type,last4,verification_status FROM linqasend_payment_methods
      WHERE user_id=$1 AND deleted_at IS NULL AND type::text IN ('BANK_ACCOUNT','DEBIT_CARD') ORDER BY created_at DESC`, [p.userId]);
    return { items: rows.map(r => ({ id: r.id, type: r.type, last4: r.last4, status: r.verification_status })) };
  }));
  app.get('/v2/wallet/limits', secured(async (_r, p) => {
    // Match WalletMoneyPolicy's currency-wide usage, including legacy entry points.
    const { rows } = await db.query(`SELECT w.id AS wallet_id,trim(w.currency) AS currency,w.status,
      l.active AS configured,l.per_operation_minor::text,l.daily_minor::text,u.used::text AS used_minor,
      CASE WHEN l.daily_minor IS NULL THEN NULL ELSE greatest(l.daily_minor::numeric-u.used,0)::text END AS remaining_minor
      FROM linqasend_wallet_accounts_v2 w LEFT JOIN linqasend_wallet_money_limits l
        ON l.regulatory_entity_id=w.regulatory_entity_id AND l.currency=w.currency AND l.active
      CROSS JOIN LATERAL (SELECT
        coalesce((SELECT sum((snapshot->>'totalMinor')::numeric) FROM linqasend_wallet_money_operations
          WHERE user_id=$1 AND snapshot->>'currency'=trim(w.currency) AND created_at>now()-interval '24 hours' AND status NOT IN ('FAILED','CANCELED')),0)
        +coalesce((SELECT sum(amount_minor) FROM linqasend_deposit_requests
          WHERE receiver_user_id=$1 AND currency=w.currency AND created_at>now()-interval '24 hours' AND status NOT IN ('FAILED','CANCELED')),0)
        +coalesce((SELECT sum(send_amount_minor) FROM linqasend_transfers
          WHERE user_id=$1 AND send_currency=w.currency AND created_at>now()-interval '24 hours' AND status NOT IN ('FAILED','DECLINED','CANCELED','EXPIRED')),0) AS used) u
      WHERE w.user_id=$1 ORDER BY w.currency,w.id`, [p.userId]);
    return { period: 'ROLLING_24_HOURS', includesFees: true, usageSources: ['WALLET_OPERATIONS', 'BANK_CASH_OUTS', 'LINQASEND_TRANSFERS'],
      items: rows.map(r => ({ walletId: r.wallet_id, currency: r.currency, status: r.status, configured: r.configured === true,
        perOperationMinor: r.per_operation_minor, dailyMinor: r.daily_minor, usedMinor: r.used_minor, remainingMinor: r.remaining_minor })) };
  }));
  app.get('/v2/wallet/report-options', secured(async (_r, p) => {
    const { rows } = await db.query(`SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM') AS period,count(*)::int AS count
      FROM linqasend_wallet_money_operations WHERE ${OWNED} GROUP BY 1 ORDER BY 1 DESC`, [p.userId]);
    return { formats: ['CSV'], reportType: 'TRANSACTION_REPORT', timezone: 'UTC', periods: rows };
  }));
  app.get('/v2/wallet/reports/:period', secured(async (r, p) => {
    const { period, start, end } = reportPeriod((r.params as { period: string }).period);
    const { rows } = await db.query(`SELECT id,kind,status,created_at,
      CASE WHEN user_id=$1 THEN 'SENT' ELSE 'RECEIVED' END AS direction,
      CASE WHEN user_id=$1 THEN snapshot->>'currency' ELSE snapshot->>'receiveCurrency' END AS currency,
      CASE WHEN user_id=$1 THEN snapshot->>'amountMinor' ELSE snapshot->>'receiveAmountMinor' END AS amount_minor
      FROM linqasend_wallet_money_operations WHERE ${OWNED} AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
      ORDER BY created_at,id LIMIT 10001`, [p.userId, start, end]);
    if (!rows.length) return { status: 'EMPTY', filename: null, content: null };
    // Refuse rather than silently export an incomplete financial report.
    if (rows.length > 10000) return { status: 'PERIOD_TOO_LARGE', filename: null, content: null };
    const header = ['operation_id', 'created_at_utc', 'kind', 'direction', 'currency', 'amount_minor', 'status'];
    const content = [header, ...rows.map(r => [r.id, new Date(r.created_at).toISOString(), r.kind, r.direction, r.currency, r.amount_minor, r.status])]
      .map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return { status: 'READY', filename: `wallet-transactions-${period}.csv`, mimeType: 'text/csv', content };
  }));
}
