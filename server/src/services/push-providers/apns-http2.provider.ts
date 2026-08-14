import { connect } from "node:http2";
import { SignJWT, importPKCS8 } from "jose";
import type { PushV2Provider } from "../push-v2.service.js";

const TOKEN_LIFETIME_MS = 50 * 60 * 1000; // Apple allows up to ~60 min; refresh at 50.

/**
 * Real implementation of PushV2Provider's APNs half (2026-08-07), using
 * Node's built-in http2 client and the ES256 provider-auth-token scheme
 * (RFC 7519 JWT signed with the .p8 key from the Apple Developer portal) —
 * no APNs SDK dependency needed. One HTTP/2 connection is opened and torn
 * down per send; a persistent connection pool would reduce latency under
 * load but adds real complexity (idle-timeout/GOAWAY handling) that isn't
 * worth the risk for a first real implementation.
 */
export class ApnsHttp2Provider {
  private cachedToken: { jwt: string; issuedAt: number } | null = null;

  constructor(
    private readonly teamId: string,
    private readonly keyId: string,
    private readonly privateKeyP8: string,
    private readonly sandbox: boolean
  ) {}

  private async authToken(): Promise<string> {
    if (this.cachedToken && Date.now() - this.cachedToken.issuedAt < TOKEN_LIFETIME_MS) {
      return this.cachedToken.jwt;
    }

    const key = await importPKCS8(this.privateKeyP8, "ES256");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.keyId })
      .setIssuer(this.teamId)
      .setIssuedAt()
      .sign(key);

    this.cachedToken = { jwt, issuedAt: Date.now() };
    return jwt;
  }

  async health(): Promise<void> {
    await this.authToken();
    const host = this.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    await new Promise<void>((resolve, reject) => {
      const session = connect(host); const timer = setTimeout(() => session.destroy(new Error("APNs health timeout")), 3_000);
      session.once("connect", () => { clearTimeout(timer); session.close(); resolve(); });
      session.once("error", reject);
    });
  }

  async send(input: { token: string; topic: string; payload: Record<string, unknown> }): Promise<{ messageId?: string }> {
    const authorization = await this.authToken();
    const host = this.sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    const body = JSON.stringify(input.payload);

    return new Promise((resolve, reject) => {
      const session = connect(host);
      session.on("error", (err) => {
        session.destroy();
        reject(err);
      });

      const req = session.request({
        ":method": "POST",
        ":path": `/3/device/${input.token}`,
        authorization: `bearer ${authorization}`,
        "apns-topic": input.topic,
        "apns-push-type": "background",
        "apns-priority": "5",
        "content-type": "application/json"
      });

      let responseStatus = 0;
      let apnsId: string | undefined;
      let responseBody = "";

      req.on("response", (headers) => {
        responseStatus = Number(headers[":status"] ?? 0);
        const idHeader = headers["apns-id"];
        apnsId = typeof idHeader === "string" ? idHeader : undefined;
      });
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        responseBody += chunk;
      });
      req.on("end", () => {
        session.close();
        if (responseStatus >= 200 && responseStatus < 300) {
          resolve({ ...(apnsId !== undefined ? { messageId: apnsId } : {}) });
        } else {
          reject(new Error(`APNs delivery failed (${responseStatus}): ${responseBody || "no body"}`));
        }
      });
      req.on("error", (err) => {
        session.close();
        reject(err);
      });

      req.end(body);
    });
  }
}
