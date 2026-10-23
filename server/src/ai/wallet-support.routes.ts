import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { createAuthenticator, requireScope } from "../auth/jwt.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import { askGemini, defaultModels } from "./gemini.js";
import { looksSensitive, walletSupportPrompt } from "./wallet-support.js";

/**
 * Wallet support chat. A Gemini-backed help assistant for the Linqa Wallet, with the same rules as Linqa AI:
 *  - opt-in: refused unless this person's AI privacy setting allows cloud processing;
 *  - nothing by default: the model sees only the conversation in this request. It is given no balance, no activity, no recipients
 *    and no account details, and nothing here is stored or logged;
 *  - it cannot act: it explains, and points to Contact support for anything about a specific payment or account.
 * A message that looks like a card or account number, or a PIN, password or code, is refused before it goes anywhere.
 */
const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(800) })).min(1).max(16)
}).strict();

const limit = simpleRateLimit({ windowMs: 60_000, max: 12, keyPrefix: "wallet-support-chat" });

export async function registerWalletSupportRoutes(app: FastifyInstance, config: AppConfig, db: Database, deps: { fetchImpl?: typeof fetch } = {}) {
  const authenticate = createAuthenticator(config);

  app.post("/v2/wallet/support-chat", async (request, reply) => {
    let principal;
    try {
      principal = await authenticate(request);
      requireScope(principal, "ai:use");
      requireScope(principal, "linqasend:read");
    } catch {
      return reply.code(401).send({ error: { code: "UNAUTHENTICATED", requestId: request.id } });
    }
    try { limit(principal.userId, request); } catch { return reply.code(429).send({ error: { code: "RATE_LIMITED", requestId: request.id } }); }

    const parsed = Body.safeParse(request.body);
    if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1]!.role !== "user") {
      return reply.code(422).send({ error: { code: "INVALID_REQUEST", requestId: request.id } });
    }
    const { messages } = parsed.data;
    // Only the person's own words are checked: an earlier assistant reply can't have been typed by them.
    if (messages.some((m) => m.role === "user" && looksSensitive(m.text))) {
      return reply.code(422).send({ error: { code: "SENSITIVE_DATA", requestId: request.id } });
    }

    const settings = await db.query(`SELECT ai_mode FROM user_settings_v2 WHERE user_id = $1`, [principal.userId]);
    const mode = (settings.rows[0] as { ai_mode?: string } | undefined)?.ai_mode ?? "DISABLED";
    if (mode !== "CONFIDENTIAL_CLOUD") return reply.code(403).send({ error: { code: "AI_DISABLED", requestId: request.id } });
    if (!config.GEMINI_API_KEY) return reply.code(503).send({ error: { code: "AI_NOT_CONFIGURED", requestId: request.id } });

    const result = await askGemini({
      apiKey: config.GEMINI_API_KEY, models: defaultModels(config.GEMINI_MODEL), system: walletSupportPrompt(),
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
      temperature: 0.2, maxOutputTokens: 700, log: request.log, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})
    });
    void reply.header("Cache-Control", "private, no-store");
    if (result.kind === "busy") return reply.code(429).send({ error: { code: "AI_BUSY", requestId: request.id } });
    if (result.kind === "unavailable") return reply.code(502).send({ error: { code: "AI_UNAVAILABLE", requestId: request.id } });
    if (result.kind === "empty") return reply.code(200).send({ reply: "I can't help with that one. Try rephrasing, or open Contact support.", model: result.model });
    return reply.code(200).send({ reply: result.text, model: result.model });
  });
}
