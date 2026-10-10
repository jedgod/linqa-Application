/**
 * Client send path for encrypted thread attachments.
 * Capture stays on device. Only a sealed envelope is posted.
 */
import type { SecureCoreMessaging } from "./ConversationService";
import type { ApiClient } from "./ApiClient";
import type { ThreadPayload } from "../conversation/thread-actions";

export class AttachmentSendService {
  constructor(
    private readonly api: ApiClient,
    private readonly core: SecureCoreMessaging,
  ) {}

  async send(conversationId: string, payload: ThreadPayload) {
    const sealed = await this.core.encrypt({
      conversationId,
      plaintext: JSON.stringify(payload),
      messageType: payload.kind,
    });
    return this.api.request(`/v2/chats/${conversationId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        id: sealed.messageId,
        kind: payload.kind,
        vaultId: "vaultId" in payload ? payload.vaultId : undefined,
        envelopeBase64: toBase64Url(sealed.ciphertext),
      }),
    });
  }

  async requestLocation(conversationId: string, peerUserId: string) {
    return this.api.request(`/v2/chats/${conversationId}/location-requests`, {
      method: "POST",
      body: JSON.stringify({ id: `loc_${Date.now()}`, peerUserId }),
    });
  }

  async shareLocation(input: {
    shareId: string;
    conversationId: string;
    label: string;
    latitude: number;
    longitude: number;
    minutes: number;
  }) {
    const sealed = await this.core.encrypt({
      conversationId: input.conversationId,
      plaintext: JSON.stringify({
        kind: "LOCATION",
        label: input.label,
        latitude: input.latitude,
        longitude: input.longitude,
        liveMinutes: input.minutes,
      }),
      messageType: "LOCATION",
    });
    return this.api.request(`/v2/location-shares/${input.shareId}/answer`, {
      method: "POST",
      body: JSON.stringify({
        accept: true,
        envelopeBase64: toBase64Url(sealed.ciphertext),
        expiresAt: new Date(Date.now() + input.minutes * 60_000).toISOString(),
      }),
    });
  }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
