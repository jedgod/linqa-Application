import { Injectable, Logger } from '@nestjs/common';
import { createPrivateKey, KeyObject, sign } from 'crypto';

export interface FcmResult {
  ok: boolean;
  status: number;
  unregistered: boolean;
}

/**
 * FCM HTTP v1, data-only, high priority. No firebase-admin dependency.
 *   FCM_SERVICE_ACCOUNT_JSON  the service account JSON (one line) from
 *                             Firebase console > Project settings > Service accounts
 */
@Injectable()
export class FcmClient {
  private readonly log = new Logger(FcmClient.name);
  private readonly sa = parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
  private access?: { token: string; exp: number };
  private key?: KeyObject;

  get enabled(): boolean {
    return !!this.sa;
  }

  async sendData(token: string, data: Record<string, string>, ttlSec = 45): Promise<FcmResult> {
    if (!this.sa) return { ok: false, status: 0, unregistered: false };
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: { token, data, android: { priority: 'HIGH', ttl: `${ttlSec}s` } },
      }),
    });
    let code = '';
    if (!res.ok) {
      try {
        const body: any = await res.json();
        code = body?.error?.details?.find((d: any) => d.errorCode)?.errorCode ?? body?.error?.status ?? '';
      } catch {}
      this.log.warn(`FCM ${res.status} ${code}`);
    }
    return {
      ok: res.ok,
      status: res.status,
      unregistered: res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT',
    };
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.access && this.access.exp - 120 > now) return this.access.token;
    this.key ??= createPrivateKey(this.sa!.private_key);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.sa!.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`;
    const assertion = `${unsigned}.${sign('sha256', Buffer.from(unsigned), this.key).toString('base64url')}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`FCM auth failed: ${res.status}`);
    const json: any = await res.json();
    this.access = { token: json.access_token, exp: now + Number(json.expires_in ?? 3600) };
    return this.access.token;
  }
}

function parse(raw?: string): { project_id: string; client_email: string; private_key: string } | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return j.project_id && j.client_email && j.private_key ? j : null;
  } catch {
    return null;
  }
}
