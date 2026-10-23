import { describe, expect, it } from 'vitest';
import { scheduledFee } from '../services/linqasend/wallet-fee-schedule.js';

describe('wallet fee schedule (integer minor units)', () => {
  it('internal: 10% with a 0.45 minimum, rounded half up', () => {
    expect(scheduledFee('INTERNAL', 'USD', '100')).toBe(45n);   // 10% = 10 -> minimum
    expect(scheduledFee('INTERNAL', 'USD', '450')).toBe(45n);   // 10% = 45 exactly
    expect(scheduledFee('INTERNAL', 'USD', '451')).toBe(45n);   // 45.1 -> 45
    expect(scheduledFee('INTERNAL', 'USD', '455')).toBe(46n);   // 45.5 -> half up
    expect(scheduledFee('INTERNAL', 'USD', '2500')).toBe(250n);
    expect(scheduledFee('INTERNAL', 'USD', '1')).toBe(45n);
  });

  it('external: 15.99% with a 0.65 minimum, rounded half up', () => {
    expect(scheduledFee('EXTERNAL', 'USD', '100')).toBe(65n);   // 15.99 -> minimum
    expect(scheduledFee('EXTERNAL', 'USD', '5000')).toBe(800n); // 799.5 -> half up
    expect(scheduledFee('EXTERNAL', 'USD', '10000')).toBe(1599n);
    expect(scheduledFee('EXTERNAL', 'USD', '4065')).toBe(650n); // 649.9935 -> 650, equals the minimum
  });

  it('matches the reference vectors for both schedules, including each crossover', () => {
    // [kind, amountMinor, expected fee, expected total debit]
    const vectors: Array<['INTERNAL' | 'EXTERNAL', string, bigint, bigint]> = [
      ['INTERNAL', '100', 45n, 145n],    // minimum floor
      ['INTERNAL', '450', 45n, 495n],    // percentage equals the floor exactly
      ['INTERNAL', '455', 46n, 501n],    // 45.5 rounds half up
      ['INTERNAL', '2000', 200n, 2200n], // percentage above the floor
      ['EXTERNAL', '200', 65n, 265n],    // minimum floor
      ['EXTERNAL', '406', 65n, 471n],    // 64.92 rounds to the floor value
      ['EXTERNAL', '409', 65n, 474n],    // 65.40 still rounds to the floor value
      ['EXTERNAL', '410', 66n, 476n],    // first amount where the percentage exceeds the floor (65.56 -> 66)
      ['EXTERNAL', '500', 80n, 580n]     // 79.95 rounds half up
    ];
    for (const [kind, amount, fee, total] of vectors) {
      const actual = scheduledFee(kind, 'USD', amount);
      expect([kind, amount, actual, BigInt(amount) + (actual ?? 0n)]).toEqual([kind, amount, fee, total]);
    }
  });

  it('is exact for amounts beyond double precision', () => {
    expect(scheduledFee('INTERNAL', 'USD', '9007199254740993')).toBe(900719925474099n);
    expect(scheduledFee('EXTERNAL', 'USD', '9007199254740993')).toBe(1440251160833085n);
  });

  it('has no schedule for other currencies and rejects invalid amounts', () => {
    expect(scheduledFee('INTERNAL', 'EUR', '1000')).toBeNull();
    expect(() => scheduledFee('INTERNAL', 'USD', '0')).toThrow('WALLET_FEE_AMOUNT_INVALID');
    expect(() => scheduledFee('INTERNAL', 'USD', '-5')).toThrow('WALLET_FEE_AMOUNT_INVALID');
    expect(() => scheduledFee('INTERNAL', 'USD', '1.5')).toThrow('WALLET_FEE_AMOUNT_INVALID');
  });
});
