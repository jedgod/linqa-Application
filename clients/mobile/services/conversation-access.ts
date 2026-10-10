/**
 * Device access a thread action needs before it may capture (from the Linqa Capture Access pack).
 * Anything but an explicit grant fails closed: the page must not open a camera, a picker or a share.
 */

export type DeviceAccess = "CAMERA" | "MICROPHONE" | "PHOTOS" | "FILES" | "CONTACTS" | "LOCATION" | "SCREEN";
export type AccessState = "GRANTED" | "DENIED" | "UNDETERMINED";

export interface AccessPrompt {
  request(access: DeviceAccess): Promise<AccessState>;
}

/** What each action needs, in the order it is asked for. Poll, Event, Meeting and AI image need no device access. */
export const ACCESS_FOR = {
  PHOTO: ["CAMERA", "PHOTOS"],
  VIDEO: ["CAMERA", "MICROPHONE"],
  VOICE: ["MICROPHONE"],
  DOCUMENT: ["FILES"],
  DESIGN: ["PHOTOS", "FILES"],
  CONTACT: ["CONTACTS"],
  LOCATION: ["LOCATION"],
  LIVE_SCREEN: ["SCREEN"]
} as const satisfies Record<string, readonly DeviceAccess[]>;
export type CaptureAction = keyof typeof ACCESS_FOR;

export const ACCESS_LABEL: Record<DeviceAccess, string> = {
  CAMERA: "camera", MICROPHONE: "microphone", PHOTOS: "photo", FILES: "file", CONTACTS: "contacts", LOCATION: "location", SCREEN: "screen capture"
};

/** "camera and photo", "microphone", "file": what to name when saying what an action needs. */
export function accessNames(action: CaptureAction): string {
  const names = ACCESS_FOR[action].map((a) => ACCESS_LABEL[a]);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** This build has no permission modules, so every request is denied. A real prompt replaces this when they are added. */
export const deniedAccessPrompt: AccessPrompt = { async request() { return "DENIED"; } };

export const DESIGN_TYPES = ["image/jpeg", "image/png", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
/** Design / crop takes a photo, a PDF or a Word document, and nothing else. Case and parameters are ignored. */
export const designFileAllowed = (mime: string): boolean => DESIGN_TYPES.includes(mime.split(";")[0]!.trim().toLowerCase());

export type AccessResult = { ok: true } | { ok: false; missing: DeviceAccess };

export class ThreadAccessGate {
  constructor(private readonly prompt: AccessPrompt) {}

  /** Asks for each access in turn and stops at the first one that is not granted. A prompt that throws counts as denied. */
  async allow(action: CaptureAction): Promise<AccessResult> {
    for (const access of ACCESS_FOR[action]) {
      let state: AccessState;
      try { state = await this.prompt.request(access); } catch { state = "DENIED"; }
      if (state !== "GRANTED") return { ok: false, missing: access };
    }
    return { ok: true };
  }
}

/** What to tell the person when access was not granted. */
export const accessDeniedMessage = (missing: DeviceAccess): string => `Allow ${ACCESS_LABEL[missing]} access in your phone's settings to use this.`;
