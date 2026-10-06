import crypto from "node:crypto";

export type CursorPayload = {
  /** Offset into the deterministic ranking. */
  o: number;
  /** Policy version the page was issued under. */
  pv: number;
  /** Hash of the filters, so a cursor cannot be replayed against other filters. */
  fh: string;
  iat: number;
};

const MAX_AGE_MS = 15 * 60 * 1000;

function bad(code: string): never {
  throw Object.assign(new Error(code), { status: 400, code });
}

export function cursorKey(config: { COUNTRYLINQA_CURSOR_SECRET?: string | undefined; JWT_HS256_SECRET: string }): Buffer {
  // Derived, not reused: the JWT secret itself never signs a cursor.
  return config.COUNTRYLINQA_CURSOR_SECRET
    ? Buffer.from(config.COUNTRYLINQA_CURSOR_SECRET)
    : crypto.createHmac("sha256", config.JWT_HS256_SECRET).update("countrylinqa-cursor-v1").digest();
}

const sign = (key: Buffer, body: string) => crypto.createHmac("sha256", key).update(body).digest("base64url");

export function encodeCursor(key: Buffer, payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(key, body)}`;
}

export function decodeCursor(key: Buffer, token: string, expected: { pv: number; fh: string }, now = Date.now()): CursorPayload {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) bad("INVALID_CURSOR");
  const want = Buffer.from(sign(key, body));
  const got = Buffer.from(signature);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) bad("INVALID_CURSOR");
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    bad("INVALID_CURSOR");
  }
  if (!Number.isInteger(payload.o) || payload.o < 0 || !Number.isFinite(payload.iat)) bad("INVALID_CURSOR");
  if (now - payload.iat > MAX_AGE_MS) bad("CURSOR_EXPIRED");
  // A policy change makes every outstanding cursor unusable rather than leaking
  // candidates the new policy would not show.
  if (payload.pv !== expected.pv) bad("CURSOR_STALE");
  if (payload.fh !== expected.fh) bad("CURSOR_FILTER_MISMATCH");
  return payload;
}
