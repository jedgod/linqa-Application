import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHttpLinqaSendProviders } from '../integrations/linqasend/http.providers.js';
import { moneySnapshot, payoutInstruction, type MoneySnapshot } from '../integrations/linqasend/wallet-money.contracts.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function snapshot(over: Partial<MoneySnapshot> = {}): MoneySnapshot {
  // An outside send of $50.00 with the platform's 15.99% fee ($8.00): the wallet is debited $58.00.
  return moneySnapshot.parse({
    id: uuid(1), userId: uuid(2), walletId: uuid(3), kind: 'EXTERNAL', amountMinor: '5000', feeMinor: '800', totalMinor: '5800', currency: 'USD',
    receiveAmountMinor: '5000', receiveCurrency: 'USD', entityId: 'entity', country: 'US', jurisdictionVersion: 1, targetId: uuid(4), targetCountry: 'US',
    targetHash: 'a'.repeat(64), targetWalletId: null, providerId: 'money-provider', providerQuoteId: 'quote-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), estimatedArrival: 'Estimate only', fxRate: '1', ...over
  });
}

describe('payout instruction: the rail is told to pay the base amount, never the fee', () => {
  it('pays the base amount and keeps the fee out of the payout', () => {
    const p = payoutInstruction(snapshot());
    expect(p).toEqual({ sourceAmountMinor: '5000', sourceCurrency: 'USD', recipientAmountMinor: '5000', recipientCurrency: 'USD', platformFeeMinor: '800', platformFeeRetained: true });
    expect(p.sourceAmountMinor).not.toBe('5800');
    expect(p.recipientAmountMinor).not.toBe('5800');
  });

  it('keeps the recipient amount in the recipient currency for FX sends', () => {
    const p = payoutInstruction(snapshot({ receiveAmountMinor: '3900', receiveCurrency: 'GBP', fxRate: '0.78' }));
    expect(p).toMatchObject({ sourceAmountMinor: '5000', sourceCurrency: 'USD', recipientAmountMinor: '3900', recipientCurrency: 'GBP' });
  });

  it('refuses a quote whose total is not amount plus fee', () => {
    expect(() => payoutInstruction(snapshot({ totalMinor: '5900' }))).toThrow('WALLET_PAYOUT_INSTRUCTION_INVALID');
    expect(() => payoutInstruction(snapshot({ feeMinor: '900' }))).toThrow('WALLET_PAYOUT_INSTRUCTION_INVALID');
  });

  describe('over actual loopback HTTP', () => {
    let server: Server, base: string;
    const bodies: any[] = [];
    beforeAll(async () => {
      server = createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : null;
        if (req.method === 'POST' && req.url === '/wallet-money/operations') {
          bodies.push(body);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ operationId: body.snapshot.id, providerQuoteId: 'quote-1', providerId: 'money-provider', providerRef: 'paid-1', eventId: 'e-1', status: 'PROCESSING', snapshotHash: body.snapshotHash, amountMinor: body.snapshot.amountMinor, currency: body.snapshot.currency }));
        } else res.writeHead(404).end('{}');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))); });

    it('sends the explicit payout block next to the quote, with the base amount and never the total', async () => {
      const s = snapshot();
      await createHttpLinqaSendProviders(base, 'token').walletMoney!.execute({ snapshot: s, snapshotHash: 'b'.repeat(64), targetReference: 'vault:target', idempotencyKey: 'key-1', payout: payoutInstruction(s) });
      const sent = bodies.at(-1)!;
      expect(sent.payout).toEqual({ sourceAmountMinor: '5000', sourceCurrency: 'USD', recipientAmountMinor: '5000', recipientCurrency: 'USD', platformFeeMinor: '800', platformFeeRetained: true });
      // The only place the total appears is the quote itself, which the gateway must not pay out.
      expect(JSON.stringify(sent.payout)).not.toContain('5800');
      expect(sent.snapshot.totalMinor).toBe('5800');
    });
  });
});
