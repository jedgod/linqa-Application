import { scrypt } from "@noble/hashes/scrypt.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

/**
 * Per-account, per-device transfer PIN (a created 6-digit code).
 *
 * It is a second factor on THIS device: it must be entered before the app will
 * use the device signing key to authorize a transfer. The server's own security
 * authorization (device-bound signature) still decides whether the transfer is
 * allowed; this only stops someone holding an unlocked phone from sending money.
 *
 * The PIN itself is never stored, only a salted scrypt hash, in the account's
 * secure storage. Failed attempts are counted persistently so closing and
 * reopening the app does not reset the limit.
 */

export interface PinStorage {
  get(userId: string, key: string): Promise<string | null>;
  put(userId: string, key: string, value: string): Promise<void>;
  remove(userId: string, key: string): Promise<void>;
}

const HASH_KEY = "transfer.pin.hash";
const STATE_KEY = "transfer.pin.state";
export const PIN_LENGTH = 6;
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;
/**
 * scrypt cost. Hashing runs in JavaScript on the phone: N=2^13 took about 20 seconds per check on a
 * low-end Android in a development build, which made the PIN screen look frozen. 2^11 keeps it to a
 * second or so in a release build. The cost is stored with each hash, so it can be raised later and
 * PINs made with older settings still verify.
 */
const COST_N = 2 ** 11;
const LEGACY_COST_N = 2 ** 13;
const scryptOptions = (N: number) => ({ N, r: 8, p: 1, dkLen: 32 }) as const;

export type PinCheck = { ok: true } | { ok: false; reason: "WRONG" | "LOCKED" | "NOT_SET"; attemptsLeft: number; lockedUntil: number | null };
export type PinProblem = "FORMAT" | "WEAK" | null;

/** Six digits, and not an easily guessed pattern. */
export function pinProblem(pin: string): PinProblem {
  if (!/^\d{6}$/.test(pin)) return "FORMAT";
  if (/^(\d)\1{5}$/.test(pin)) return "WEAK";
  const digits = [...pin].map(Number);
  const step = digits[1]! - digits[0]!;
  if ((step === 1 || step === -1) && digits.every((d, i) => i === 0 || d - digits[i - 1]! === step)) return "WEAK";
  if (["121212", "123123", "112233", "696969"].includes(pin)) return "WEAK";
  return null;
}

function derive(pin: string, salt: Uint8Array, N: number): string {
  return bytesToHex(scrypt(new TextEncoder().encode(pin), salt, scryptOptions(N)));
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type State = { failures: number; lockedUntil: number | null };

export class TransactionPinStore {
  constructor(private readonly storage: PinStorage, private readonly now: () => number = Date.now) {}

  async hasPin(userId: string): Promise<boolean> {
    return (await this.storage.get(userId, HASH_KEY)) !== null;
  }

  /** Sets (or replaces) the PIN. Callers must already have verified the old PIN when replacing. */
  async setPin(userId: string, pin: string): Promise<void> {
    const problem = pinProblem(pin);
    if (problem) throw new Error(problem === "WEAK" ? "PIN_TOO_EASY_TO_GUESS" : "PIN_MUST_BE_6_DIGITS");
    const salt = randomBytes(16);
    await this.storage.put(userId, HASH_KEY, `s1$${COST_N}$${bytesToHex(salt)}$${derive(pin, salt, COST_N)}`);
    await this.storage.put(userId, STATE_KEY, JSON.stringify({ failures: 0, lockedUntil: null } satisfies State));
  }

  private async state(userId: string): Promise<State> {
    try {
      const parsed = JSON.parse((await this.storage.get(userId, STATE_KEY)) ?? "null") as Partial<State> | null;
      return { failures: Number(parsed?.failures) || 0, lockedUntil: typeof parsed?.lockedUntil === "number" ? parsed.lockedUntil : null };
    } catch {
      return { failures: 0, lockedUntil: null };
    }
  }

  async status(userId: string): Promise<{ attemptsLeft: number; lockedUntil: number | null }> {
    const state = await this.state(userId);
    const locked = state.lockedUntil !== null && state.lockedUntil > this.now();
    return { attemptsLeft: locked ? 0 : Math.max(0, MAX_ATTEMPTS - state.failures), lockedUntil: locked ? state.lockedUntil : null };
  }

  async verify(userId: string, pin: string): Promise<PinCheck> {
    const stored = await this.storage.get(userId, HASH_KEY);
    if (!stored) return { ok: false, reason: "NOT_SET", attemptsLeft: 0, lockedUntil: null };

    let state = await this.state(userId);
    if (state.lockedUntil !== null && state.lockedUntil > this.now()) {
      return { ok: false, reason: "LOCKED", attemptsLeft: 0, lockedUntil: state.lockedUntil };
    }
    // A finished lockout starts a fresh set of attempts.
    if (state.lockedUntil !== null) state = { failures: 0, lockedUntil: null };

    // "s1$<N>$<salt>$<hash>"; PINs created before the cost was stored are "<salt>:<hash>" at N=2^13.
    const parts = stored.startsWith("s1$") ? stored.split("$").slice(1) : [String(LEGACY_COST_N), ...stored.split(":")];
    const [costText, saltHex, hash] = parts;
    const cost = Number(costText);
    const good = Boolean(saltHex && hash) && Number.isInteger(cost) && cost >= 1024 && cost <= LEGACY_COST_N * 4
      && /^\d{6}$/.test(pin) && equal(derive(pin, hexToBytes(saltHex!), cost), hash!);
    if (good) {
      await this.storage.put(userId, STATE_KEY, JSON.stringify({ failures: 0, lockedUntil: null } satisfies State));
      return { ok: true };
    }
    const failures = state.failures + 1;
    const lockedUntil = failures >= MAX_ATTEMPTS ? this.now() + LOCKOUT_MS : null;
    await this.storage.put(userId, STATE_KEY, JSON.stringify({ failures, lockedUntil } satisfies State));
    return { ok: false, reason: lockedUntil ? "LOCKED" : "WRONG", attemptsLeft: Math.max(0, MAX_ATTEMPTS - failures), lockedUntil };
  }

  async clear(userId: string): Promise<void> {
    await this.storage.remove(userId, HASH_KEY);
    await this.storage.remove(userId, STATE_KEY);
  }
}
