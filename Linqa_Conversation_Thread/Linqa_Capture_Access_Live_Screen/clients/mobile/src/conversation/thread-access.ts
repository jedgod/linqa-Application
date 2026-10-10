/**
 * Device access required before a thread action can capture.
 * Denied permission fails closed. The page must not open the picker.
 */

export type DeviceAccess =
  | "CAMERA"
  | "MICROPHONE"
  | "PHOTOS"
  | "FILES"
  | "CONTACTS"
  | "LOCATION"
  | "SCREEN";

export type AccessState = "GRANTED" | "DENIED" | "UNDETERMINED";

export interface AccessPrompt {
  request(access: DeviceAccess): Promise<AccessState>;
}

export const ACCESS_FOR: Record<string, DeviceAccess[]> = {
  PHOTO: ["CAMERA", "PHOTOS"],
  VIDEO: ["CAMERA", "MICROPHONE"],
  VOICE: ["MICROPHONE"],
  DOCUMENT: ["FILES"],
  DESIGN: ["PHOTOS", "FILES"],
  CONTACT: ["CONTACTS"],
  LOCATION: ["LOCATION"],
  LIVE_SCREEN: ["SCREEN"],
};

export const DESIGN_TYPES = ["image/jpeg", "image/png", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

export class ThreadAccessGate {
  constructor(private readonly prompt: AccessPrompt) {}

  async allow(action: keyof typeof ACCESS_FOR): Promise<{ ok: true } | { ok: false; missing: DeviceAccess }> {
    for (const access of ACCESS_FOR[action]) {
      const state = await this.prompt.request(access);
      if (state !== "GRANTED") return { ok: false, missing: access };
    }
    return { ok: true };
  }
}

export function designFileAllowed(mime: string): boolean {
  return DESIGN_TYPES.includes(mime);
}
