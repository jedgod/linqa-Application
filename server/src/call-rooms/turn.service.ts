import { createHmac } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { IceServer } from "./calls.protocol.js";
export class TurnService {
  constructor(private readonly config: AppConfig) {}
  iceServersFor(userId: string, now = Date.now()): IceServer[] {
    const urls = this.config.TURN_URLS.filter(url => /^turns?:/i.test(url) && !/(?:127\.0\.0\.1|localhost|\[::1\])(?::|[/?]|$)/i.test(url));
    if (!urls.length) throw new Error("TURN relay is unavailable");
    const username = `${Math.floor(now / 1000) + 3600}:${userId}`;
    return [{ urls, username, credential:createHmac("sha1",this.config.TURN_SHARED_SECRET).update(username).digest("base64") }];
  }
}
