import { ThreadAccessGate, designFileAllowed, deniedAccessPrompt, type AccessPrompt, type AccessResult, type CaptureAction } from "./conversation-access";

/** The part of the conversation service that carries a screen-share offer. */
export interface ScreenOfferer {
  offerScreen(conversationId: string, sessionId: string): Promise<{ id: string; state: "OFFERED" }>;
}

export type CaptureResult = AccessResult | { ok: false; missing: "FILES"; reason: "DESIGN_TYPE_REJECTED" };

/**
 * Starts a capture only after the phone has granted the access it needs. This build has no capture itself (no camera,
 * microphone, picker, location or screen module), so each method answers "may I?" and nothing here ever opens one.
 */
export class CaptureActivation {
  private readonly access: ThreadAccessGate;
  constructor(prompt: AccessPrompt = deniedAccessPrompt, private readonly screens?: ScreenOfferer, private readonly newId: () => string = () => "") {
    this.access = new ThreadAccessGate(prompt);
  }

  allow(action: CaptureAction): Promise<AccessResult> { return this.access.allow(action); }

  /** Design / crop: the access first, then the file type (photo, PDF or Word only). */
  async design(mime: string): Promise<CaptureResult> {
    const gate = await this.access.allow("DESIGN");
    if (!gate.ok) return gate;
    if (!designFileAllowed(mime)) return { ok: false, missing: "FILES", reason: "DESIGN_TYPE_REJECTED" };
    return { ok: true };
  }

  /** Offers to share the screen: access first, then the sealed offer. Nothing is sent when access is not granted. */
  async offerScreen(conversationId: string): Promise<{ ok: true; id: string } | Exclude<AccessResult, { ok: true }>> {
    const gate = await this.access.allow("LIVE_SCREEN");
    if (!gate.ok) return gate;
    if (!this.screens) throw new Error("SCREEN_SIGNALING_UNAVAILABLE");
    const id = this.newId();
    await this.screens.offerScreen(conversationId, id);
    return { ok: true, id };
  }
}
