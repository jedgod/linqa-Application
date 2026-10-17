// Development-only card provider for the LinqaSend sandbox. Loopback only; in-memory only.
// Receives card details directly from the app (never through the Linqa API), keeps only
// brand/last4/expiry, and discards the full number and CVV immediately. Never logs request bodies.
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

const PROVIDER_ID = "dev-sandbox";

export function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return digits.length >= 12 && sum % 10 === 0;
}

export function brandOf(digits) {
  if (/^4/.test(digits)) return "VISA";
  if (/^(5[1-5]|2(2[2-9]|[3-6]|7[01]|720))/.test(digits)) return "MASTERCARD";
  if (/^3[47]/.test(digits)) return "AMEX";
  if (/^6(011|5)/.test(digits)) return "DISCOVER";
  return "UNKNOWN";
}

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function createCardProvider({ token, baseUrl }) {
  if (!token || token.length < 16) throw new Error("provider token must be at least 16 characters");
  const sessions = new Map();
  const methods = new Map(); // providerPaymentMethodRef -> userId
  const cvvSessions = new Map(); // sessionId -> { userId, clientSecret, expiresAt, cvvOk, consumed }
  const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const read = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 16_384) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("bad_json")); } });
    req.on("error", reject);
  });
  const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer /, "");

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", baseUrl);
      if (req.method === "POST" && url.pathname === "/payment-methods/setup") {
        if (!same(bearer(req), token)) return send(res, 401, { error: "unauthorized" });
        const body = await read(req);
        if (!["DEBIT_CARD", "CREDIT_CARD"].includes(body.type)) return send(res, 422, { error: "card_type_only" });
        const setupToken = `seti_${randomBytes(12).toString("hex")}`, clientSecret = `secret_${randomBytes(18).toString("hex")}`;
        sessions.set(setupToken, { userId: String(body.userId), type: body.type, billingCountry: body.billingCountry, clientSecret, expiresAt: Date.now() + 10 * 60_000, card: null });
        return send(res, 201, { setupToken, clientSecret, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), cardEndpoint: `${baseUrl}/cards/${setupToken}` });
      }
      const card = /^\/cards\/(seti_[a-f0-9]+)$/.exec(url.pathname);
      if (req.method === "POST" && card) {
        const session = sessions.get(card[1]);
        if (!session || session.expiresAt < Date.now() || !same(bearer(req), session.clientSecret)) return send(res, 401, { error: "invalid_setup_session" });
        const body = await read(req);
        const number = String(body.number ?? "").replace(/\D/g, "");
        const expMonth = Number(body.expMonth), expYear = Number(body.expYear);
        if (!luhn(number)) return send(res, 422, { error: "invalid_card_number" });
        if (!(expMonth >= 1 && expMonth <= 12) || expYear < new Date().getFullYear()) return send(res, 422, { error: "invalid_expiry" });
        if (!/^\d{3,4}$/.test(String(body.cvv ?? ""))) return send(res, 422, { error: "invalid_security_code" });
        session.card = { brand: brandOf(number), last4: number.slice(-4), expMonth, expYear: expYear < 100 ? 2000 + expYear : expYear };
        return send(res, 204, {});
      }
      if (req.method === "POST" && url.pathname === "/payment-methods/confirm") {
        if (!same(bearer(req), token)) return send(res, 401, { error: "unauthorized" });
        const body = await read(req);
        const session = sessions.get(String(body.setupToken));
        if (!session || session.userId !== String(body.userId) || !session.card) return send(res, 409, { error: "setup_not_completed" });
        sessions.delete(String(body.setupToken));
        const providerPaymentMethodRef = `pm_dev_${randomBytes(12).toString("hex")}`;
        methods.set(providerPaymentMethodRef, session.userId);
        return send(res, 200, { provider: PROVIDER_ID, providerPaymentMethodRef, type: session.type, last4: session.card.last4, billingCountry: session.billingCountry, verificationStatus: "VERIFIED", brand: session.card.brand, expMonth: session.card.expMonth, expYear: session.card.expYear });
      }
      // Security-code recollection: the app types the code for each payment and posts it here directly.
      if (req.method === "POST" && url.pathname === "/cvv-sessions") {
        if (!same(bearer(req), token)) return send(res, 401, { error: "unauthorized" });
        const body = await read(req);
        const ref = String(body.paymentMethodRef ?? ""), owner = methods.get(ref);
        // In-memory only: after a restart the provider forgets earlier cards, so it trusts the API's vault-verified ownership for pm_dev_ refs.
        if (!ref.startsWith("pm_dev_") || (owner !== undefined && owner !== String(body.userId))) return send(res, 404, { error: "unknown_payment_method" });
        const sessionId = `cvvs_${randomBytes(12).toString("hex")}`, clientSecret = `cvvsecret_${randomBytes(18).toString("hex")}`;
        cvvSessions.set(sessionId, { userId: String(body.userId), clientSecret, expiresAt: Date.now() + 5 * 60_000, cvvOk: false, consumed: false });
        return send(res, 201, { sessionId, clientSecret, cvvEndpoint: `${baseUrl}/cvv/${sessionId}` });
      }
      const cvv = /^\/cvv\/(cvvs_[a-f0-9]+)$/.exec(url.pathname);
      if (req.method === "POST" && cvv) {
        const session = cvvSessions.get(cvv[1]);
        if (!session || session.expiresAt < Date.now() || session.consumed || !same(bearer(req), session.clientSecret)) return send(res, 401, { error: "invalid_cvv_session" });
        const body = await read(req);
        if (!/^\d{3,4}$/.test(String(body.cvv ?? ""))) return send(res, 422, { error: "invalid_security_code" });
        session.cvvOk = true; // the digits are discarded; a real provider's issuer validates the value itself
        return send(res, 204, {});
      }
      if (req.method === "POST" && url.pathname === "/cvv-sessions/consume") {
        if (!same(bearer(req), token)) return send(res, 401, { error: "unauthorized" });
        const body = await read(req);
        const session = cvvSessions.get(String(body.sessionId));
        if (!session || session.userId !== String(body.userId) || session.expiresAt < Date.now() || session.consumed || !session.cvvOk) return send(res, 409, { error: "cvv_not_provided" });
        session.consumed = true;
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "not_found" });
    } catch (error) {
      return send(res, error?.message === "too_large" ? 413 : 400, { error: "bad_request" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === "production") throw new Error("The development card sandbox provider cannot run in production");
  const port = Number(process.env.LINQASEND_DEV_CARD_PROVIDER_PORT ?? 8099);
  const server = createCardProvider({ token: process.env.LINQASEND_DEV_CARD_PROVIDER_TOKEN ?? "", baseUrl: `http://127.0.0.1:${port}` });
  server.listen(port, "127.0.0.1", () => console.log(`Development card sandbox provider listening on 127.0.0.1:${port}`));
}
