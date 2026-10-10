import type { Payload } from "./conversation-engine";
import type { ConversationServiceLike, DecryptResult, MessagingGateLike, ServerRow } from "./conversation-types";

/**
 * SAMPLE DATA FOR DESIGN REVIEW ONLY. This drives the real conversation screen with made-up messages held in memory
 * (nothing is sent to the server, nothing is encrypted) so the layout can be looked at while real messaging is locked.
 * It is only reachable from the development-only preview route, which refuses to open in a release build.
 */
export const PREVIEW_SELF = "preview-me";
export const PREVIEW_PEER = "preview-jerry";

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(); d.setHours(h!, m!, 0, 0);
  return d.toISOString();
};

type Seed = { id: string; from: typeof PREVIEW_SELF | typeof PREVIEW_PEER; time: string; body: Payload | "UNREADABLE" };
const text = (t: string): Payload => ({ type: "text", text: t, lane: "General" });
const decision = (title: string, options: string[]): Payload => ({ type: "decision", title, options });
const vote = (boardId: string, choice: number): Payload => ({ type: "vote", boardId, choice });

const SEED: Seed[] = [
  { id: "m1", from: PREVIEW_PEER, time: "9:41", body: text("Are we still on for the walkthrough Thursday?") },
  { id: "m2", from: PREVIEW_PEER, time: "9:41", body: text("I can move it to the afternoon if that works better.") },
  { id: "m3", from: PREVIEW_SELF, time: "9:44", body: text("Morning works. 10 at the site?") },
  { id: "m4", from: PREVIEW_PEER, time: "9:52", body: text("Perfect. I will bring the updated floor plan.") },
  { id: "m5", from: PREVIEW_PEER, time: "9:53", body: "UNREADABLE" },
  { id: "m6", from: PREVIEW_SELF, time: "9:55", body: text("That last one did not open on my end. Can you resend it?") },
  { id: "e1", from: PREVIEW_PEER, time: "9:55", body: { type: "meeting", title: "Site walkthrough", startsAt: at("14:00"), durationMinutes: 45 } },
  // Decisions page: two open, three decided.
  { id: "d1", from: PREVIEW_SELF, time: "9:56", body: decision("Who books the meeting room?", ["I will", "Jerry will"]) },
  { id: "v1", from: PREVIEW_PEER, time: "9:57", body: vote("d1", 1) },
  { id: "d2", from: PREVIEW_PEER, time: "9:58", body: decision("Which floor plan do we review?", ["Revision C", "Revision B"]) },
  { id: "v2", from: PREVIEW_SELF, time: "9:59", body: vote("d2", 0) },
  { id: "d3", from: PREVIEW_SELF, time: "10:00", body: decision("Lunch after the walkthrough?", ["Yes", "No"]) },
  { id: "v3", from: PREVIEW_SELF, time: "10:01", body: vote("d3", 0) }, { id: "v4", from: PREVIEW_PEER, time: "10:01", body: vote("d3", 0) },
  { id: "d4", from: PREVIEW_PEER, time: "10:02", body: decision("Start time Thursday?", ["10 AM", "2 PM"]) },
  { id: "v5", from: PREVIEW_SELF, time: "10:03", body: vote("d4", 0) }, { id: "v6", from: PREVIEW_PEER, time: "10:03", body: vote("d4", 0) },
  { id: "d5", from: PREVIEW_SELF, time: "10:04", body: decision("Bring printed copies?", ["Yes", "Digital only"]) },
  { id: "v7", from: PREVIEW_SELF, time: "10:05", body: vote("d5", 1) }, { id: "v8", from: PREVIEW_PEER, time: "10:05", body: vote("d5", 0) }
];

/** In-memory conversation. Typing a message that contains "fail" shows the "not sent" state with Retry and Delete. */
export function createPreviewConversation(): { service: ConversationServiceLike; gate: MessagingGateLike } {
  const rows: ServerRow[] = SEED.map((s) => ({ id: s.id, senderId: s.from, sentAt: at(s.time), ciphertext: s.id }));
  const bodies = new Map<string, Payload | "UNREADABLE">(SEED.map((s) => [s.id, s.body]));
  const listeners = new Set<(row: ServerRow) => void>();
  let next = 0;
  const failed = new Set<string>();

  const service: ConversationServiceLike = {
    async loadHistory() { return { rows: [...rows] }; },
    async decryptServerRows(_c, wanted): Promise<DecryptResult[]> {
      return wanted.map((r) => {
        const body = bodies.get(r.id);
        return !body || body === "UNREADABLE" ? { id: r.id, ok: false as const } : { id: r.id, ok: true as const, text: JSON.stringify(body) };
      });
    },
    async send(_c, payload, clientMessageId) {
      if (payload.type === "text" && /fail/i.test(payload.text) && !failed.has(clientMessageId)) { failed.add(clientMessageId); throw new Error("PREVIEW_FAILURE"); }
      const row: ServerRow = { id: `sent-${++next}`, senderId: PREVIEW_SELF, sentAt: new Date().toISOString(), ciphertext: `c${next}` };
      rows.push(row); bodies.set(row.id, payload);
      listeners.forEach((l) => l(row));
      return row;
    },
    async markRead() { /* nothing to record in a preview */ },
    subscribe(_c, onRow) { listeners.add(onRow); return () => { listeners.delete(onRow); }; }
  };
  const gate: MessagingGateLike = { async evaluate() { return { mode: "LIVE" }; } };
  return { service, gate };
}
