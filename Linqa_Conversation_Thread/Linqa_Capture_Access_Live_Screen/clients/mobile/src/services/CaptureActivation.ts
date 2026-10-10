import type { ApiClient } from "./ApiClient";
import type { SecureCoreMessaging } from "./ConversationService";
import { ThreadAccessGate, designFileAllowed, type AccessPrompt } from "../conversation/thread-access";

export class CaptureActivation {
  constructor(
    private readonly access: ThreadAccessGate,
    private readonly api: ApiClient,
    private readonly core: SecureCoreMessaging,
  ) {}

  static create(prompt: AccessPrompt, api: ApiClient, core: SecureCoreMessaging) {
    return new CaptureActivation(new ThreadAccessGate(prompt), api, core);
  }

  async photo() {
    return this.access.allow("PHOTO");
  }

  async video() {
    return this.access.allow("VIDEO");
  }

  async voice() {
    return this.access.allow("VOICE");
  }

  async document() {
    return this.access.allow("DOCUMENT");
  }

  async contact() {
    return this.access.allow("CONTACT");
  }

  async location() {
    return this.access.allow("LOCATION");
  }

  async design(mime: string) {
    const gate = await this.access.allow("DESIGN");
    if (!gate.ok) return gate;
    if (!designFileAllowed(mime)) return { ok: false as const, missing: "FILES" as const, reason: "DESIGN_TYPE_REJECTED" };
    return { ok: true as const };
  }

  async offerScreen(conversationId: string) {
    const gate = await this.access.allow("LIVE_SCREEN");
    if (!gate.ok) return gate;
    const offer = await this.core.encrypt({
      conversationId,
      plaintext: JSON.stringify({ kind: "LIVE_SCREEN", at: Date.now() }),
      messageType: "LIVE_SCREEN",
    });
    return this.api.request(`/v2/chats/${conversationId}/screen-shares`, {
      method: "POST",
      body: JSON.stringify({
        id: offer.messageId,
        offerEnvelopeBase64: toBase64Url(offer.ciphertext),
      }),
    });
  }
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
