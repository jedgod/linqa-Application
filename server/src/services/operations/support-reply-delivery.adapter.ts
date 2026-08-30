import type { RealtimeHub } from "../../realtime/hub.js";

export interface SupportReplyDelivery {
  sendToClient(input: {
    clientUserId: string;
    caseId: string;
    messageId: string;
    body: string;
  }): Promise<{ accepted: boolean; transportMessageId?: string | null }>;
}

// hub.sendToUser() (realtime/hub.ts) is a synchronous, fire-and-forget
// best-effort push to whatever devices are currently connected -- it has no
// delivery acknowledgement and never throws for "no connections". Matching
// case-assignment.service.ts's existing use of the same hub, "accepted"
// here means "handed to the hub", not "the client actually received it".
export class ExistingHubSupportReplyDelivery implements SupportReplyDelivery {
  constructor(private readonly hub: RealtimeHub) {}

  async sendToClient(input: {
    clientUserId: string;
    caseId: string;
    messageId: string;
    body: string;
  }) {
    this.hub.sendToUser(input.clientUserId, {
      type: "ops.case.reply",
      caseId: input.caseId,
      messageId: input.messageId,
      body: input.body
    });
    return { accepted: true, transportMessageId: input.messageId };
  }
}
