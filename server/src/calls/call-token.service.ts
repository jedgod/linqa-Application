import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "../config.js";

/**
 * Join tokens for a call room.
 *
 * The v2 pack's contract asks for a token that is "short-lived, audience-bound
 * and single-call scoped". Each of those is a separate containment property and
 * all three are enforced here:
 *
 *  - **Short-lived.** Five minutes, so a token captured from a log or a crash
 *    report is worthless by the time anyone reads it.
 *  - **Audience-bound.** `aud: linqa-call`. A join token is not an API access
 *    token, and the API authenticator will not accept one -- so leaking a join
 *    token cannot be escalated into reading the holder's messages.
 *  - **Single-call scoped.** The `cid` claim names one call, and the media
 *    plane must compare it to the room it is admitting into. A token for one
 *    call is not a token for another.
 *
 * It is also bound to the user *and* the device, so a token lifted from one
 * device cannot be replayed from another.
 *
 * These tokens must never be logged. `redactJoinToken` exists so that the one
 * place we do want to describe a token -- an audit row -- records a fingerprint
 * instead of the credential.
 */

const CALL_TOKEN_AUDIENCE = "linqa-call";
const DEFAULT_TTL_SECONDS = 300;

export interface CallJoinClaims {
  callId: string;
  userId: string;
  deviceId: string;
  /** AUDIO | VIDEO | SCREEN_SHARE, so the media plane can refuse an upgrade. */
  callType: string;
  /** RELAY_ONLY forces TURN, hiding peer IPs. */
  privacyMode: string;
}

export class CallTokenService {
  private readonly secret: Uint8Array;

  constructor(private readonly config: AppConfig) {
    this.secret = new TextEncoder().encode(config.JWT_HS256_SECRET);
  }

  async issue(claims: CallJoinClaims, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<{
    joinToken: string;
    expiresAt: string;
  }> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const joinToken = await new SignJWT({
      cid: claims.callId,
      user_id: claims.userId,
      device_id: claims.deviceId,
      call_type: claims.callType,
      privacy_mode: claims.privacyMode
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`call:${claims.callId}:${claims.userId}`)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(CALL_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret);

    return { joinToken, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Verifies a join token for one specific call.
   *
   * `expectedCallId` is required rather than optional: a verify that only
   * checks the signature would accept a valid token for a *different* call,
   * which is exactly the confused-deputy the `cid` claim exists to prevent.
   */
  async verify(token: string, expectedCallId: string): Promise<CallJoinClaims> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: this.config.JWT_ISSUER,
      audience: CALL_TOKEN_AUDIENCE,
      algorithms: ["HS256"]
    });
    if (payload.cid !== expectedCallId) throw new Error("call token is not for this call");
    if (typeof payload.user_id !== "string" || typeof payload.device_id !== "string") {
      throw new Error("call token is missing identity claims");
    }
    return {
      callId: String(payload.cid),
      userId: payload.user_id,
      deviceId: payload.device_id,
      callType: String(payload.call_type ?? "AUDIO"),
      privacyMode: String(payload.privacy_mode ?? "STANDARD")
    };
  }
}

/**
 * A stable, non-reversible fingerprint of a token, for audit rows and logs.
 *
 * Enough to correlate "this token was issued and then used", never enough to
 * replay it.
 */
export function redactJoinToken(token: string): string {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (Math.imul(hash, 31) + token.charCodeAt(index)) | 0;
  }
  return `jt_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const CALL_TOKEN_CONSTANTS = { CALL_TOKEN_AUDIENCE, DEFAULT_TTL_SECONDS };
