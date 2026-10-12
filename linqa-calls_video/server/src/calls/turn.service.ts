import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { IceServer } from './calls.protocol';

/**
 * Short-lived TURN credentials using coturn's REST scheme
 * (coturn: use-auth-secret + static-auth-secret=<TURN_SECRET>).
 *
 *   username   = "<unixExpiry>:<userId>"
 *   credential = base64(HMAC-SHA1(TURN_SECRET, username))
 *
 * TURN only relays DTLS-SRTP packets. It cannot decrypt call media.
 */
@Injectable()
export class TurnService {
  private readonly stunUrls = splitList(process.env.STUN_URLS ?? 'stun:stun.l.google.com:19302');
  private readonly turnUrls = splitList(process.env.TURN_URLS ?? '');
  private readonly secret = process.env.TURN_SECRET ?? '';
  private readonly ttlSec = Number(process.env.TURN_TTL_SECONDS ?? 6 * 60 * 60);

  iceServersFor(userId: string, now = Date.now()): IceServer[] {
    const servers: IceServer[] = [];
    if (this.stunUrls.length) servers.push({ urls: this.stunUrls });
    if (this.turnUrls.length && this.secret) {
      const expiry = Math.floor(now / 1000) + this.ttlSec;
      const username = `${expiry}:${userId}`;
      const credential = createHmac('sha1', this.secret).update(username).digest('base64');
      servers.push({ urls: this.turnUrls, username, credential });
    }
    return servers;
  }
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
