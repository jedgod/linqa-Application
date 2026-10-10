import Fastify from "fastify";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/pool.js";
import { registerThreadAttachmentRoutes } from "../../chat/thread-attachment.routes.js";
import { ThreadAttachmentService } from "../../chat/thread-attachment.service.js";

const config = { JWT_ISSUER: "linqa-test", JWT_AUDIENCE: "linqa-api", JWT_HS256_SECRET: "attachment-test-secret-at-least-32-characters" } as AppConfig;
const userId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const envelope = Buffer.alloc(64, 7);
async function headers() {
  const jwt = await new SignJWT({ user_id: userId, scope: "messages:send messages:read" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuer(config.JWT_ISSUER).setAudience(config.JWT_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode(config.JWT_HS256_SECRET));
  return { authorization: `Bearer ${jwt}` };
}
afterEach(() => vi.restoreAllMocks());

describe("encrypted shared attachment routes", () => {
  it("accepts CONTACT through the authenticated relay and passes only opaque bytes", async () => {
    const accept = vi.spyOn(ThreadAttachmentService.prototype, "accept").mockResolvedValue({ id, accepted: true, duplicate: false });
    const app = Fastify();
    try {
      await registerThreadAttachmentRoutes(app, config, {} as Database);
      const response = await app.inject({ method: "POST", url: `/v2/chats/${conversationId}/attachments`, headers: await headers(), payload: { id, kind: "CONTACT", envelopeBase64: envelope.toString("base64url") } });
      expect(response.statusCode).toBe(201);
      expect(accept).toHaveBeenCalledWith({ id, conversationId, userId, deviceId: null, kind: "CONTACT", vaultId: null, envelope });
    } finally { await app.close(); }
  });

  it("rejects cleartext metadata and AI exception flags before reaching storage", async () => {
    const accept = vi.spyOn(ThreadAttachmentService.prototype, "accept");
    const app = Fastify();
    try {
      await registerThreadAttachmentRoutes(app, config, {} as Database);
      for (const extra of [{ phone: "+13015550100" }, { latitude: 38.95 }, { cleartextException: "ai_prompt" }]) {
        const response = await app.inject({ method: "POST", url: `/v2/chats/${conversationId}/attachments`, headers: await headers(), payload: { id, kind: "CONTACT", envelopeBase64: envelope.toString("base64url"), ...extra } });
        expect(response.statusCode).toBe(422);
      }
      expect(accept).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("requires authentication before accepting a shared card", async () => {
    const accept = vi.spyOn(ThreadAttachmentService.prototype, "accept");
    const app = Fastify();
    try {
      await registerThreadAttachmentRoutes(app, config, {} as Database);
      const response = await app.inject({ method: "POST", url: `/v2/chats/${conversationId}/attachments`, payload: { id, kind: "CONTACT", envelopeBase64: envelope.toString("base64url") } });
      expect(response.statusCode).toBe(401);
      expect(accept).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
