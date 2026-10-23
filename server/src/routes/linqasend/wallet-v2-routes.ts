import type { FastifyInstance, FastifyReply, FastifyRequest, InjectOptions } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { SqlClient } from '../../db/migration-runner.js';
import { createPaymentAuthenticator } from '../../auth/payment-authenticator.js';
import { requireScope } from '../../auth/jwt.js';
import type { AuthPrincipal } from '../../auth/types.js';
import { INVOICE_ERROR_STATUS, MAX_TTL_SECONDS, MIN_TTL_SECONDS, WalletInvoiceService } from '../../services/linqasend/wallet-invoice.service.js';
import { feeScheduleView } from '../../services/linqasend/wallet-fee-schedule.js';
import { IDEMPOTENCY_KEY_PATTERN, requestHash, WalletIdempotencyService } from '../../services/linqasend/wallet-idempotency.service.js';
import { registerWalletMoreRoutes } from './wallet-more-routes.js';

type Method = 'GET' | 'POST';

/**
 * Standalone Wallet API under /v2/wallet/*. `/v2/wallet` itself is the Cards & Passes vault and is untouched.
 *
 * Money routes forward to the existing audited /v1/linqasend wallet handler, so authentication, scopes, rate
 * limits, biometric binding, custody coverage and the fail-closed release flag are enforced exactly once, in one place.
 * Read-only More services are registered separately; money changes stay in the audited handlers.
 */
const ROUTES: ReadonlyArray<readonly [Method, string, string]> = [
  ['GET', '/v2/wallet/profile', '/v1/linqasend/wallet-profile'],
  ['GET', '/v2/wallet/balances','/v1/linqasend/wallets'],
  ['GET', '/v2/wallet/balances/:id/activity', '/v1/linqasend/wallets/:id/activity'],
  ['GET', '/v2/wallet/receipts', '/v1/linqasend/wallet-receipts'],
  ['POST', '/v2/wallet/open', '/v1/linqasend/wallets/open'],
  ['POST', '/v2/wallet/withdrawals/:id/cancel', '/v1/linqasend/wallet-withdrawals/:id/cancel'],
  ['GET', '/v2/wallet/money/targets', '/v1/linqasend/wallet-money/targets'],
  ['GET', '/v2/wallet/money/operations', '/v1/linqasend/wallet-money/operations'],
  ['GET', '/v2/wallet/money/operations/:id', '/v1/linqasend/wallet-money/operations/:id'],
  ['POST', '/v2/wallet/money/quotes', '/v1/linqasend/wallet-money/quotes'],
  ['POST', '/v2/wallet/invoices/:id/quotes', '/v1/linqasend/wallet-money/invoices/:id/quotes'],
  ['POST', '/v2/wallet/money/quotes/:id/challenge', '/v1/linqasend/wallet-money/quotes/:id/challenge'],
  ['POST', '/v2/wallet/money/quotes/:id/submit', '/v1/linqasend/wallet-money/quotes/:id/submit'],
  ['POST', '/v2/wallet/money/quotes/:id/resolve', '/v1/linqasend/wallet-money/quotes/:id/resolve'],
  ['POST', '/v2/wallet/money/operations/:id/cancel', '/v1/linqasend/wallet-money/operations/:id/cancel'],
  ['POST', '/v2/wallet/money/operations/:id/refund', '/v1/linqasend/wallet-money/operations/:id/refund'],
  ['POST', '/v2/wallet/bank-links', '/v1/linqasend/bank-links'],
  ['POST', '/v2/wallet/bank-links/:id/confirm', '/v1/linqasend/bank-links/:id/confirm']
];

const DROPPED_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding']);
const KEPT_RESPONSE_HEADERS = ['content-type', 'retry-after'];

const WAIT_FOR_FIRST_MS = 5_000;
const POLL_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type WalletV2Deps = {
  linkingConfigured?: boolean;
  authenticate: (request: FastifyRequest) => Promise<{ userId: string }>;
  idempotency: Pick<WalletIdempotencyService, 'begin' | 'complete' | 'abort'>;
  principal: (request: FastifyRequest) => Promise<AuthPrincipal>;
  invoices: Pick<WalletInvoiceService, 'create' | 'lookup'>;
};

/**
 * An optional `Idempotency-Key` header on a POST makes a retry safe: the same key and request replays the stored 2xx
 * response, a concurrent duplicate waits for the first, and the same key with a different request is refused.
 * Without the header nothing changes. If the key store is unavailable the request is refused rather than run unguarded.
 */
export async function registerWalletV2Routes(app: FastifyInstance, config: AppConfig, db: SqlClient, deps?: Partial<WalletV2Deps>): Promise<void> {
  await registerWalletMoreRoutes(app, config, db, undefined, deps?.linkingConfigured);
  const authenticate = deps?.authenticate ?? createPaymentAuthenticator(config, db);
  const idempotency = deps?.idempotency ?? new WalletIdempotencyService(db);
  registerInvoiceRoutes(app, deps?.principal ?? createPaymentAuthenticator(config, db), deps?.invoices ?? new WalletInvoiceService(db));

  const forward = async (request: FastifyRequest, method: Method, target: string) => {
    const params = request.params as Record<string, string>;
    const path = target.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params[key] ?? ''));
    const queryAt = request.url.indexOf('?');
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !DROPPED_REQUEST_HEADERS.has(name)) headers[name] = value;
    }
    const options: InjectOptions = {
      method,
      url: path + (queryAt >= 0 ? request.url.slice(queryAt) : ''),
      headers,
      // Keeps the per-client rate limit and the client binding on the real caller, not on loopback.
      remoteAddress: request.ip,
      ...(method === 'POST' ? { payload: JSON.stringify(request.body ?? {}) } : {})
    };
    return app.inject(options);
  };

  const relay = (reply: FastifyReply, forwarded: Awaited<ReturnType<typeof forward>>) => {
    for (const name of KEPT_RESPONSE_HEADERS) {
      const value = forwarded.headers[name];
      if (value !== undefined) reply.header(name, value);
    }
    return reply.code(forwarded.statusCode).send(forwarded.rawPayload);
  };

  // Read-only price list for the app's amount-screen preview. It is an estimate: the quote's fee is what is charged.
  app.get('/v2/wallet/fees', async (request, reply) => {
    try { await authenticate(request); } catch { return reply.code(401).send({ error: 'unauthorized' }); }
    return reply.header('cache-control', 'private, max-age=60').send({ version: 1, schedules: feeScheduleView() });
  });

  for (const [method, url, target] of ROUTES) {
    app.route({
      method,
      url,
      handler: async (request, reply) => {
        const rawKey = request.headers['idempotency-key'];
        if (rawKey === undefined || method !== 'POST') return relay(reply, await forward(request, method, target));
        if (typeof rawKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(rawKey)) return reply.code(422).send({ error: 'INVALID_IDEMPOTENCY_KEY' });

        let userId: string;
        try { userId = (await authenticate(request)).userId; }
        catch { return relay(reply, await forward(request, method, target)); } // the wallet handler produces the real auth error

        let hash: string;
        try { hash = requestHash(method, url, request.body); }
        catch { return reply.code(422).send({ error: 'INVALID_IDEMPOTENT_REQUEST' }); }

        const deadline = Date.now() + WAIT_FOR_FIRST_MS;
        let decision;
        for (;;) {
          try { decision = await idempotency.begin(userId, rawKey, method, url, hash); }
          catch (error) {
            request.log.error({ code: (error as { code?: string }).code }, 'wallet idempotency store unavailable');
            return reply.code(503).send({ error: 'IDEMPOTENCY_UNAVAILABLE' });
          }
          if (decision.kind !== 'in_progress' || Date.now() >= deadline) break;
          await sleep(POLL_MS);
        }

        if (decision.kind === 'mismatch') return reply.code(422).send({ error: 'IDEMPOTENCY_KEY_REUSED' });
        if (decision.kind === 'in_progress') return reply.code(409).header('retry-after', '1').send({ error: 'IDEMPOTENCY_IN_PROGRESS' });
        if (decision.kind === 'replay') return reply.header('idempotent-replayed', 'true').code(decision.code).send(decision.body);

        try {
          const forwarded = await forward(request, method, target);
          let body: unknown;
          try { body = JSON.parse(forwarded.payload); } catch { body = undefined; }
          await idempotency.complete(decision.id, forwarded.statusCode, body);
          return relay(reply, forwarded);
        } catch (error) {
          await idempotency.abort(decision.id).catch(() => undefined);
          throw error;
        }
      }
    });
  }
}

const createInvoiceBody = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.string().regex(/^[1-9]\d{0,14}$/),
  ttlSeconds: z.number().int().min(MIN_TTL_SECONDS).max(MAX_TTL_SECONDS)
}).strict();

/**
 * One-time invoices (LinqaStealthPay). These routes create and resolve an invoice only; they never move money. Paying one
 * is a wallet transfer through the audited quote, biometric and hold path. They sit outside the idempotency middleware on
 * purpose: a replayed create response would keep the plain invoice code in the replay store, and only its hash is meant to
 * be stored. A repeated create just makes another invoice, which expires on its own and counts toward the open-invoice cap.
 */
function registerInvoiceRoutes(app: FastifyInstance, auth: WalletV2Deps['principal'], invoices: WalletV2Deps['invoices']): void {
  const rate = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  const guarded = (scope: 'linqasend:read' | 'linqasend:write', okStatus: number, work: (request: FastifyRequest, principal: AuthPrincipal) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      let principal: AuthPrincipal;
      try { principal = await auth(request); } catch { return reply.code(401).send({ error: 'unauthorized' }); }
      try { requireScope(principal, scope); } catch { return reply.code(403).send({ error: 'wallet_scope_required' }); }
      reply.header('cache-control', 'no-store');
      try { return reply.code(okStatus).send(await work(request, principal)); }
      catch (error) {
        if (error instanceof z.ZodError) return reply.code(422).send({ error: 'INVALID_INVOICE_REQUEST' });
        const code = error instanceof Error ? error.message : '';
        const status = INVOICE_ERROR_STATUS[code];
        if (status !== undefined) return reply.code(status).send({ error: code });
        request.log.error({ err: error }, 'wallet invoices unavailable');
        return reply.code(503).send({ error: 'wallet_invoices_unavailable' });
      }
    };

  app.post('/v2/wallet/invoices', rate, guarded('linqasend:write', 201, (request, principal) => invoices.create(principal.userId, createInvoiceBody.parse(request.body))));
  app.get('/v2/wallet/invoices/lookup', rate, guarded('linqasend:read', 200, (request, principal) => {
    const { code } = z.object({ code: z.string().max(100) }).parse(request.query);
    return invoices.lookup(principal.userId, code);
  }));
}
