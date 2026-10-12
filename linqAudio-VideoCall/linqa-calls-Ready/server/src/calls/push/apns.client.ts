import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createPrivateKey, KeyObject, sign } from 'crypto';
import { connect, ClientHttp2Session, constants } from 'http2';

export interface ApnsResult {
  ok: boolean;
  status: number;
  /** True when Apple says the token is dead and should be deleted. */
  unregistered: boolean;
  reason?: string;
}

/**
 * Minimal APNs HTTP/2 client for PushKit VoIP pushes, token-based auth (.p8).
 *   APNS_KEY_P8      contents of AuthKey_XXXX.p8 (newlines as \n are fine)
 *   APNS_KEY_ID      the key's id
 *   APNS_TEAM_ID     Apple team id
 *   APNS_BUNDLE_ID   app bundle id, e.g. app.linqa.mobile
 *   APNS_PRODUCTION  "true" for TestFlight/App Store builds
 */
@Injectable()
export class ApnsClient implements OnModuleDestroy {
  private readonly log = new Logger(ApnsClient.name);
  private session?: ClientHttp2Session;
  private jwt?: { token: string; at: number };
  private key?: KeyObject;

  readonly enabled = !!(process.env.APNS_KEY_P8 && process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID);
  private readonly host =
    process.env.APNS_PRODUCTION === 'true' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';

  onModuleDestroy(): void {
    this.session?.close();
  }

  async sendVoip(deviceToken: string, payload: Record<string, unknown>, expiresInSec = 45): Promise<ApnsResult> {
    if (!this.enabled) return { ok: false, status: 0, unregistered: false, reason: 'apns-not-configured' };
    const session = this.getSession();
    const headers = {
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
      authorization: `bearer ${this.providerToken()}`,
      'apns-push-type': 'voip',
      'apns-topic': `${process.env.APNS_BUNDLE_ID}.voip`,
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + expiresInSec),
      'content-type': 'application/json',
    };
    return new Promise((resolve) => {
      const req = session.request(headers);
      let status = 0;
      let body = '';
      req.setEncoding('utf8');
      req.on('response', (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS])));
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let reason: string | undefined;
        try {
          reason = body ? JSON.parse(body).reason : undefined;
        } catch {}
        const unregistered = status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered';
        if (status !== 200) this.log.warn(`APNs ${status} ${reason ?? ''}`);
        resolve({ ok: status === 200, status, unregistered, reason });
      });
      req.on('error', (e) => {
        this.session = undefined;
        resolve({ ok: false, status: 0, unregistered: false, reason: String(e) });
      });
      req.end(JSON.stringify(payload));
    });
  }

  private getSession(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;
    const s = connect(this.host);
    s.on('error', () => (this.session = undefined));
    s.on('goaway', () => (this.session = undefined));
    s.unref();
    this.session = s;
    return s;
  }

  /** ES256 provider token, reused for 50 minutes (Apple allows up to 60). */
  private providerToken(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && now - this.jwt.at < 50 * 60) return this.jwt.token;
    this.key ??= createPrivateKey(process.env.APNS_KEY_P8!.replace(/\\n/g, '\n'));
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID })}.${b64({ iss: process.env.APNS_TEAM_ID, iat: now })}`;
    const sig = sign('sha256', Buffer.from(unsigned), { key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.jwt = { token: `${unsigned}.${sig}`, at: now };
    return this.jwt.token;
  }
}
