import type { PushV2Provider } from "../push-v2.service.js";
import type { ApnsHttp2Provider } from "./apns-http2.provider.js";
import type { FcmHttpV1Provider } from "./fcm-http-v1.provider.js";

/** Wires the real APNs and FCM clients (each independently optional) into the single PushV2Provider interface PushV2Service expects. */
export class CompositePushV2Provider implements PushV2Provider {
  constructor(
    private readonly apns: ApnsHttp2Provider | null,
    private readonly fcm: FcmHttpV1Provider | null
  ) {}

  async health(): Promise<void> {
    if (!this.apns || !this.fcm) throw new Error("Both APNs and FCM providers are required for production health.");
    await Promise.all([this.apns.health(), this.fcm.health()]);
  }

  async sendApns(input: { token: string; topic: string; payload: Record<string, unknown> }): Promise<{ messageId?: string }> {
    if (!this.apns) throw new Error("APNs provider is not configured.");
    return this.apns.send(input);
  }

  async sendFcm(input: { token: string; payload: Record<string, unknown> }): Promise<{ messageId?: string }> {
    if (!this.fcm) throw new Error("FCM provider is not configured.");
    return this.fcm.send(input);
  }
}
