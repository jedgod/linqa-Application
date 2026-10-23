/**
 * Wallet support chat: Linqa AI answers questions about how the Wallet works. The model is told nothing about the person: it is
 * not given a balance, activity, recipients or account details, and it can't take any action. Everything here is the part that
 * runs on the phone: what may be sent, how much history goes with a question, and what each failure says.
 */
export type ChatMessage = { id: string; role: "user" | "assistant"; text: string; failed?: boolean };

export const MAX_MESSAGE = 800;
const MAX_HISTORY = 12;

export const SUGGESTIONS = [
  "How are fees calculated?",
  "How do I load money?",
  "Why is my payment pending?",
  "How do I cash out?",
  "How does Request money work?"
] as const;

/**
 * True if a message looks like something that must not be sent to an AI service: a long run of digits (a card or bank account
 * number, or a phone number), or a secret named and given together ("pin is 4821"). Deliberately blunt. The server applies the
 * same rule, so this is a courtesy that saves a round trip, not the only guard.
 */
export function looksSensitive(text: string): boolean {
  if (/(?:\d[ \-]?){9,}/.test(text)) return true;
  return /\b(cvv|cvc|pin|password|passcode|otp|code)\b\s*(?:is|=|:)\s*\S*\d/i.test(text);
}

/**
 * What goes to the server with the next question: the most recent messages, starting with a question from the person (the model
 * is never opened with its own reply), without anything that failed to send, each within the length limit.
 */
export function historyForServer(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; text: string }> {
  const kept = messages.filter((m) => !m.failed && m.text.trim()).slice(-MAX_HISTORY).map((m) => ({ role: m.role, text: m.text.trim().slice(0, MAX_MESSAGE) }));
  while (kept.length && kept[0]!.role !== "user") kept.shift();
  return kept;
}

export class SupportChatError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

/** One sentence a person can act on, for every way a question can fail. Server wording is never shown. */
export function supportChatMessage(code: string): string {
  switch (code) {
    case "AI_DISABLED": return "Linqa AI is switched off for your account. Turn it on in AI privacy to chat here.";
    case "AI_NOT_CONFIGURED": return "Chat support isn't available yet. Open Contact support instead.";
    case "AI_BUSY": case "RATE_LIMITED": return "Support chat is busy right now. Try again in a minute.";
    case "SENSITIVE_DATA": return "That looks like a card, account number, PIN or code. Please don't share those. Remove it and ask again.";
    case "UNAUTHENTICATED": return "Sign in again to use support chat.";
    case "INVALID_REQUEST": return "That message couldn't be sent. Try a shorter question.";
    case "OFFLINE": return "Couldn't reach Linqa. Check your connection and try again.";
    default: return "Support chat isn't available right now. Try again soon, or open Contact support.";
  }
}

/** Sends the conversation and returns the assistant's reply. Throws SupportChatError with a stable code on any failure. */
export async function sendSupportMessage(input: {
  baseUrl: string; getToken: () => Promise<string>; messages: ChatMessage[]; fetchImpl?: typeof fetch; timeoutMs?: number;
}): Promise<string> {
  const history = historyForServer(input.messages);
  if (!history.length || history[history.length - 1]!.role !== "user") throw new SupportChatError("INVALID_REQUEST", 0);
  if (history.some((m) => m.role === "user" && looksSensitive(m.text))) throw new SupportChatError("SENSITIVE_DATA", 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 35_000);
  try {
    const token = await input.getToken();
    const response = await (input.fetchImpl ?? fetch)(`${input.baseUrl}/v2/wallet/support-chat`, {
      method: "POST", signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: history })
    });
    const payload = (await response.json().catch(() => ({}))) as { reply?: unknown; error?: { code?: unknown } };
    if (!response.ok) throw new SupportChatError(typeof payload.error?.code === "string" ? payload.error.code : "UNAVAILABLE", response.status);
    if (typeof payload.reply !== "string" || !payload.reply.trim()) throw new SupportChatError("UNAVAILABLE", response.status);
    return payload.reply.trim();
  } catch (error) {
    if (error instanceof SupportChatError) throw error;
    if (error instanceof Error && /sign in|authenticated session/i.test(error.message)) throw new SupportChatError("UNAUTHENTICATED", 0);
    throw new SupportChatError(controller.signal.aborted || error instanceof TypeError ? "OFFLINE" : "UNAVAILABLE", 0);
  } finally { clearTimeout(timer); }
}
