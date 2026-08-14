import type { ProductionMessagingCoordinator } from "./ProductionMessagingCoordinator";
import { requireCapability, type ProductionRuntimeSnapshot } from "../runtime/capability-gate";

export class ChatSendController {
  constructor(
    private readonly messaging: ProductionMessagingCoordinator,
    private readonly capabilities: () => ProductionRuntimeSnapshot
  ) {}
  async send(input: { messageId: string; conversationId: string; recipientUserId: string; text: string }) {
    const snapshot = this.capabilities();
    requireCapability(snapshot, "secure-core");
    requireCapability(snapshot, "message-relay");
    requireCapability(snapshot, "key-transparency");
    if (!input.text.trim()) return;
    return this.messaging.send({
      conversationId: input.conversationId,
      recipientUserId: input.recipientUserId,
      plaintext: input.text,
      clientMessageId: input.messageId
    });
  }
}

