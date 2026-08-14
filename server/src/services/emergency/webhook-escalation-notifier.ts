import { createHmac } from "node:crypto";
import type { EscalationNotifier } from "../emergency-escalation.service.js";
import type { PushV2Service } from "../push-v2.service.js";

/**
 * Real implementation of EscalationNotifier (2026-08-07):
 * - notifyUser reuses the already-real PushV2Service (once APNs/FCM are
 *   configured) rather than inventing a second, redundant push path — the
 *   escalation push wake event carries only { emergencyEventId, tier }, no
 *   plaintext, matching the pack's own "push payloads contain no plaintext
 *   message content" invariant.
 * - notifyStaff posts an HMAC-signed webhook (same timestamped-HMAC scheme
 *   as the billing webhook verifier) to a configured URL. This shape is
 *   directly compatible with a generic webhook relay into PagerDuty's
 *   Events API v2, an Opsgenie/Slack incoming webhook, or any on-call
 *   tool that can verify an HMAC header — not a fake stub.
 */
export class WebhookEscalationNotifier implements EscalationNotifier {
  constructor(
    private readonly push: PushV2Service,
    private readonly staffWebhookUrl: string,
    private readonly staffWebhookSecret: string
  ) {}

  async notifyUser(input: { userId: string; emergencyEventId: string; tier: number }): Promise<void> {
    await this.push.sendWake({
      userId: input.userId,
      eventType: "EMERGENCY_ESCALATION",
      data: { emergencyEventId: input.emergencyEventId, tier: input.tier }
    });
  }

  async notifyStaff(input: { emergencyEventId: string; tier: number }): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      emergencyEventId: input.emergencyEventId,
      tier: input.tier,
      timestamp
    });

    const mac = createHmac("sha256", this.staffWebhookSecret)
      .update(`${timestamp}.`)
      .update(body)
      .digest("hex");

    const response = await fetch(this.staffWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-linqa-signature": `t=${timestamp},v1=${mac}`
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Emergency staff webhook delivery failed (${response.status}).`);
    }
  }
}
