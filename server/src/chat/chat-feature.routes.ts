import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/pool.js";
import { ChatError, assertMember, withTransaction } from "./chat.service.js";
import { idParam, makeRunner } from "./thread-route-kit.js";
import { simpleRateLimit } from "../services/countrylinqa/final/rate-limit.js";
import { createTurnCredentials } from "../calls/turn-credentials.js";

const imageSchema = z.object({ base64: z.string().min(8).max(8_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/), mime: z.enum(["image/png", "image/jpeg", "image/webp"]) }).strict();
export function validProviderImage(image: { base64: string; mime: string }): boolean {
  const bytes = Buffer.from(image.base64, "base64");
  if (!bytes.length || bytes.length > 6_000_000 || bytes.toString("base64") !== image.base64) return false;
  return image.mime === "image/png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : image.mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP";
}
export async function readProviderResponse(response: Response, max = 9_000_000): Promise<unknown> {
  if (!response.ok || !response.body) throw new ChatError(502, "IMAGE_PROVIDER_FAILED");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) throw new ChatError(502, "IMAGE_PROVIDER_FAILED"); chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); }
}
export async function registerChatFeatureRoutes(app: FastifyInstance, config: AppConfig, db: Database) {
  const run = makeRunner(config);
  const reads = simpleRateLimit({ windowMs: 60_000, max: 60, keyPrefix: "chat-features" });
  const images = simpleRateLimit({ windowMs: 3_600_000, max: 8, keyPrefix: "chat-ai-images" });
  const member = (userId: string, conversationId: string) => withTransaction(db, client => assertMember(client, userId, conversationId));
  const aiImages = !!config.CHAT_AI_IMAGE_URL && !!config.CHAT_AI_IMAGE_TOKEN;
  const live = !!config.TURN_SHARED_SECRET && config.TURN_URLS.some(url => /^turns?:/i.test(url) && !/localhost|127\.0\.0\.1|\[::1\]/i.test(url));
  app.get("/v2/chats/:id/features", run("messages:read", reads, async (request, who) => {
    await member(who.userId, idParam(request));
    return { aiImages, live };
  }));
  app.get("/v2/chats/:id/ice-servers", run("messages:send", reads, async (request, who) => {
    await member(who.userId, idParam(request));
    if (!live) throw new ChatError(503, "LIVE_PROVIDER_UNAVAILABLE");
    const turn = createTurnCredentials({ userId: who.userId, secret: config.TURN_SHARED_SECRET, urls: config.TURN_URLS, ttlSeconds: 3600 });
    return [{ urls: turn.urls, username: turn.username, credential: turn.credential }];
  }));
  app.post("/v2/chats/:id/ai-images", { bodyLimit: 8192 }, run("messages:send", images, async (request, who) => {
    const body = z.object({ prompt: z.string().trim().min(1).max(2000), style: z.enum(["Photo", "Watercolor", "Sketch", "Diagram"]), consent: z.literal(true) }).strict().parse(request.body);
    await member(who.userId, idParam(request));
    if (!aiImages) throw new ChatError(503, "AI_PROVIDER_UNAVAILABLE");
    try {
      const response = await fetch(config.CHAT_AI_IMAGE_URL!, { method: "POST", headers: { authorization: `Bearer ${config.CHAT_AI_IMAGE_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ prompt: body.prompt, style: body.style }), signal: AbortSignal.timeout(90_000), redirect: "error" });
      const parsed = z.object({ images: z.array(imageSchema).min(1).max(4) }).strict().parse(await readProviderResponse(response));
      if (!parsed.images.every(validProviderImage)) throw new ChatError(502, "IMAGE_PROVIDER_FAILED");
      return parsed.images;
    } catch { throw new ChatError(502, "IMAGE_PROVIDER_FAILED"); }
  }));
}
