import { getApiBaseUrl } from "../config/api";
import { accessTokenProvider } from "./session";

export type AssistantMessage = { role: "user" | "assistant"; text: string };
export type SharedContext = { label: string; lines: string[] };
export type AssistantImage = { mimeType: "image/jpeg" | "image/png" | "image/webp"; dataBase64: string };

/** Why the assistant could not answer, as something the screen can explain. */
export class AssistantError extends Error {
  constructor(readonly code: "AI_DISABLED" | "AI_NOT_CONFIGURED" | "AI_BUSY" | "AI_UNAVAILABLE" | "RATE_LIMITED" | "SHARED_TOO_LARGE" | "NETWORK" | "UNKNOWN", message: string) {
    super(message);
    this.name = "AssistantError";
  }
}

const EXPLAIN: Record<AssistantError["code"], string> = {
  AI_DISABLED: "Linqa AI is turned off. Turn it on to ask questions.",
  AI_NOT_CONFIGURED: "Linqa AI is not set up on the server yet.",
  AI_BUSY: "Linqa AI is busy right now. Try again in a minute.",
  AI_UNAVAILABLE: "Linqa AI could not be reached. Try again.",
  RATE_LIMITED: "You are asking too fast. Wait a few seconds.",
  SHARED_TOO_LARGE: "That is too much to share at once. Share a shorter stretch of the chat.",
  NETWORK: "No connection to Linqa. Check your network.",
  UNKNOWN: "Something went wrong. Try again."
};

export async function askAssistant(input: {
  messages: AssistantMessage[];
  shared?: SharedContext | null;
  image?: AssistantImage | null;
  appContext?: { unreadMessages?: number; pendingMessageRequests?: number; missedCalls?: number; recordingCount?: number };
}): Promise<string> {
  let response: Response;
  try {
    const token = await accessTokenProvider.getAccessToken();
    response = await fetch(`${getApiBaseUrl()}/v1/ai/assistant`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messages: input.messages.slice(-24),
        ...(input.shared && input.shared.lines.length ? { shared: input.shared } : {}),
        ...(input.image ? { image: input.image } : {}),
        ...(input.appContext ? { appContext: input.appContext } : {})
      })
    });
  } catch {
    throw new AssistantError("NETWORK", EXPLAIN.NETWORK);
  }
  const payload = (await response.json().catch(() => ({}))) as { reply?: string; error?: { code?: string } };
  if (response.ok && typeof payload.reply === "string") return payload.reply;
  const code = payload.error?.code as AssistantError["code"] | undefined;
  const known = code && code in EXPLAIN ? code : response.status === 429 ? "RATE_LIMITED" : "UNKNOWN";
  throw new AssistantError(known, EXPLAIN[known]);
}

/**
 * What the person chose to share with Linqa AI from another screen (a chat). It is held in memory for one hand-off, never saved,
 * and cleared as soon as the assistant screen reads it.
 */
let pending: SharedContext | null = null;
export function handOffToAssistant(context: SharedContext): void { pending = context; }
export function takeHandOff(): SharedContext | null { const value = pending; pending = null; return value; }

/** A photo taken in the recorder and sent on to Linqa AI. Same rules: in memory only, read once. */
let pendingImage: AssistantImage | null = null;
export function handOffImageToAssistant(image: AssistantImage): void { pendingImage = image; }
export function takeImageHandOff(): AssistantImage | null { const value = pendingImage; pendingImage = null; return value; }
