import { describe, expect, it } from "vitest";
import { CvvError, CvvRecollectionService } from "../services/linqasend/cvv-recollection.service.js";
// @ts-expect-error plain .mjs script without types
import { createCardProvider } from "../../../scripts/dev-sandbox-card-provider.mjs";

const TOKEN = "dev-provider-token-1234";
type Row = { user: string; method: string; ref: string; status: string; expires: Date };

function fakeDb() {
  const rows = new Map<string, Row>();
  return {
    rows,
    async query(sql: string, params: any[]) {
      if (sql.includes("INSERT INTO linqasend_cvv_sessions")) { rows.set(params[0], { user: params[1], method: params[2], ref: params[3], status: "PENDING", expires: params[4] }); return { rows: [] }; }
      if (sql.includes("SET status='CONSUMED'")) {
        const r = rows.get(params[0]);
        if (r && r.user === params[1] && r.method === params[2] && r.status === "PENDING" && r.expires.getTime() > Date.now()) { r.status = "CONSUMED"; return { rows: [{ provider_session_ref: r.ref }] }; }
        return { rows: [] };
      }
      if (sql.includes("SET status='PENDING'")) { const r = rows.get(params[0]); if (r) r.status = "PENDING"; return { rows: [] }; }
      throw new Error(`unexpected sql ${sql}`);
    }
  } as any;
}

async function setup() {
  const provider = createCardProvider({ token: TOKEN, baseUrl: "http://127.0.0.1:0" });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${provider.address().port}`;
  const db = fakeDb();
  const service = new CvvRecollectionService(db, { url: base, token: TOKEN });
  const typeCvv = async (session: { cvvEndpoint?: string; clientSecret: string }, cvv: string) =>
    fetch(`${base}${new URL(session.cvvEndpoint!).pathname}`, { method: "POST", headers: { authorization: `Bearer ${session.clientSecret}`, "content-type": "application/json" }, body: JSON.stringify({ cvv }) });
  return { provider, db, service, typeCvv };
}
const open = (service: CvvRecollectionService, user = "u1", method = "m1") => service.createSession({ userId: user, paymentMethodId: method, providerPaymentMethodRef: "pm_dev_abc" });

describe("card security-code recollection", () => {
  it("accepts a payment only after the sender typed the code, and only once", async () => {
    const { provider, service, typeCvv } = await setup();
    try {
      const session = await open(service);
      expect((await typeCvv(session, "812")).status).toBe(204);
      await expect(service.consume({ userId: "u1", paymentMethodId: "m1", cvvSessionId: session.cvvSessionId })).resolves.toBeUndefined();
      await expect(service.consume({ userId: "u1", paymentMethodId: "m1", cvvSessionId: session.cvvSessionId })).rejects.toMatchObject({ code: "cvv_invalid" });
    } finally { provider.close(); }
  });

  it("refuses a payment when no code was typed and lets the sender try again", async () => {
    const { provider, service, db, typeCvv } = await setup();
    try {
      const session = await open(service);
      await expect(service.consume({ userId: "u1", paymentMethodId: "m1", cvvSessionId: session.cvvSessionId })).rejects.toMatchObject({ code: "cvv_required" });
      expect(db.rows.get(session.cvvSessionId).status).toBe("PENDING");
      await typeCvv(session, "812");
      await expect(service.consume({ userId: "u1", paymentMethodId: "m1", cvvSessionId: session.cvvSessionId })).resolves.toBeUndefined();
    } finally { provider.close(); }
  });

  it("rejects malformed codes, wrong secrets, other users, other cards and expired sessions", async () => {
    const { provider, service, db, typeCvv } = await setup();
    try {
      const session = await open(service);
      expect((await typeCvv(session, "12")).status).toBe(422);
      expect((await typeCvv(session, "12a")).status).toBe(422);
      expect((await typeCvv({ ...session, clientSecret: "wrong" }, "812")).status).toBe(401);
      await typeCvv(session, "812");
      await expect(service.consume({ userId: "u2", paymentMethodId: "m1", cvvSessionId: session.cvvSessionId })).rejects.toBeInstanceOf(CvvError);
      await expect(service.consume({ userId: "u1", paymentMethodId: "m2", cvvSessionId: session.cvvSessionId })).rejects.toBeInstanceOf(CvvError);
      db.rows.get(session.cvvSessionId).expires = new Date(Date.now() - 1000);
      await expect(service.consume({ userId: "u1", paymentMethodId: "m1", cvvSessionId: session.cvvSessionId })).rejects.toMatchObject({ code: "cvv_invalid" });
    } finally { provider.close(); }
  });

  it("never echoes the typed code back in any response", async () => {
    const { provider, service, typeCvv } = await setup();
    try {
      const session = await open(service);
      const response = await typeCvv(session, "9137");
      expect(await response.text()).not.toContain("9137");
      expect(JSON.stringify(session)).not.toContain("9137");
    } finally { provider.close(); }
  });

  it("fails closed when no card provider is configured", async () => {
    const service = new CvvRecollectionService(fakeDb(), null);
    await expect(service.consume({ userId: "u1", paymentMethodId: "m1", cvvSessionId: "x" })).rejects.toMatchObject({ code: "cvv_provider_not_configured" });
  });
});
