import { describe, expect, it } from 'vitest';
import { decodeOperationCursor, encodeOperationCursor } from '../services/linqasend/wallet-money.service.js';

describe('wallet activity cursor', () => {
  const ts = '2026-10-22T22:55:40.123456Z';
  const id = '11111111-1111-4111-8111-111111111111';

  it('round-trips the exact microsecond timestamp and id', () => {
    expect(decodeOperationCursor(encodeOperationCursor(ts, id))).toEqual({ ts, id });
  });

  it('rejects anything that is not a cursor this server issued', () => {
    const forge = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
    for (const bad of [
      '', 'not base64!', 'a'.repeat(121),
      forge('2026-10-22T22:55:40Z|' + id),                    // missing microseconds
      forge(`${ts}|not-a-uuid`),
      forge(`${ts}|${id}|extra`),
      forge(`${ts}'; DROP TABLE x;--|${id}`),
      forge(`${ts}`)
    ]) expect(() => decodeOperationCursor(bad)).toThrow('WALLET_CURSOR_INVALID');
  });
});
