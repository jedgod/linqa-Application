import { z } from "zod";
import type { LinqaSendProviders } from "./provider.contracts.js";

const kycResult = z.object({ decision: z.enum(["PASS", "REVIEW", "FAIL"]), reasons: z.array(z.string()) });
const complianceResult = z.object({ decision: z.enum(["CLEAR", "REVIEW", "BLOCK"]), reasons: z.array(z.string()) });
const fundingResult = z.object({ status: z.enum(["AUTHORIZED", "REQUIRES_ACTION", "DECLINED"]), providerRef: z.string().optional(), declineCode: z.string().optional() });
const payoutResult = z.object({ status: z.enum(["SUBMITTED", "PROCESSING", "COMPLETED", "FAILED"]), providerRef: z.string() });
const fxResult = z.object({ marketRate: z.string(), executionRate: z.string(), validUntil: z.coerce.date(), sourceTimestamp: z.coerce.date() });

export function createHttpLinqaSendProviders(baseUrl: string, token: string): LinqaSendProviders {
  const request = async <T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`linqasend_provider_error:${response.status}`);
    return schema.parse(await response.json());
  };
  const post = <T>(path: string, schema: z.ZodType<T>, body: unknown) => request(path, schema, { method: "POST", body: JSON.stringify(body, (_key, value) => typeof value === "bigint" ? value.toString() : value) });
  return {
    kyc: { name: "http-provider-gateway", verifyIdentity: input => post("/kyc/verify", kycResult, input) },
    compliance: { name: "http-provider-gateway", screenPerson: input => post("/compliance/screen", complianceResult, input) },
    funding: {
      name: "http-provider-gateway",
      authorizeFunding: input => post("/funding/authorize", fundingResult, input),
      lookupByIdempotencyKey: key => request(`/funding/lookup/${encodeURIComponent(key)}`, fundingResult.nullable())
    },
    payout: {
      name: "http-provider-gateway",
      createPayout: input => post("/payouts", payoutResult, input),
      lookup: reference => request(`/payouts/${encodeURIComponent(reference)}`, payoutResult.nullable())
    },
    fx: { fetchFxRate: input => post("/fx/quote", fxResult, input) }
  };
}
