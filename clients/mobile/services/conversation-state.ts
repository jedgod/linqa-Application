import { inLane, projectMessages, type Lane, type OpenedMessage, type Payload } from "./conversation-engine";
import type { DisplayMessage, ServerRow } from "./conversation-types";
import { indexThread } from "../features/conversation/render/threadIndex";
import { HIDDEN_TYPES, type ContentMessage } from "../features/conversation/content/types";

/** Rows by id (a later copy replaces an earlier one), oldest first. */
export function mergeRows(prev: ServerRow[], incoming: ServerRow[]): ServerRow[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  for (const r of incoming) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

/**
 * What the screen lists, newest first (it is an inverted list).
 *
 * The fail-closed rule lives here: unless the gate is LIVE, every server message is sealed, whatever was
 * opened before, and nothing the person typed is shown.
 */
export function buildMessages(input: {
  live: boolean;
  rows: ServerRow[];
  opened: Record<string, DisplayMessage["body"]>;
  pending: DisplayMessage[];
  selfId: string;
}): DisplayMessage[] {
  const server: DisplayMessage[] = input.rows.map((r) => {
    const outgoing = r.senderId === input.selfId;
    return {
      id: r.id, senderId: r.senderId, sentAt: r.sentAt, outgoing,
      body: input.live ? input.opened[r.id] ?? { state: "sealed" } : { state: "sealed" },
      ...(outgoing ? { delivery: "sent" as const } : {})
    };
  });
  const all = input.live ? [...input.pending, ...server] : server;
  return all.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

export type TimelineItem =
  | { kind: "feature"; message: DisplayMessage; payload: Extract<Payload, { type: "feature" }> }
  | { kind: "share"; message: DisplayMessage; payload: Extract<Payload, { type: "location" | "contact" }> }
  | { kind: "media"; message: DisplayMessage; payload: Extract<Payload, { type: "media" }> }
  | { kind: "text"; message: DisplayMessage; payload: Extract<Payload, { type: "text" }> }
  | { kind: "board"; message: DisplayMessage; payload: Extract<Payload, { type: "decision" }>; votes: Record<string, number> }
  | { kind: "card"; message: DisplayMessage; payload: Extract<Payload, { type: "event" | "meeting" }> }
  | { kind: "closed"; message: DisplayMessage; unreadable: boolean };

/**
 * Newest first. Opened text stays text; a decision becomes a board with its votes counted (one per person,
 * the latest wins); votes themselves are not listed. Sealed and unreadable messages show only under All,
 * because their lane is inside the encryption. Unsent votes are not listed (they apply once sent).
 */
export function buildTimeline(messages: DisplayMessage[], lane: Lane): TimelineItem[] {
  const visibleFeatures = new Set(indexThread(featureMessages(messages)).visible.map(m => m.id));
  const opened: OpenedMessage[] = [];
  for (const m of messages) {
    if (m.body.state === "open") opened.push({ id: m.id, senderUserId: m.senderId, ciphertext: null, createdAt: m.sentAt, kind: "TEXT", payload: m.body.payload });
  }
  const rows = projectMessages(opened);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const items: TimelineItem[] = [];
  for (const row of rows) {
    if (!inLane(row, lane)) continue;
    const message = byId.get(row.id)!;
    if (row.payload.type === "feature" && (visibleFeatures.has(row.id) || message.delivery === "failed")) items.push({ kind: "feature", message, payload: row.payload });
    else if (row.payload.type === "decision") items.push({ kind: "board", message, payload: row.payload, votes: (row as { votes: Record<string, number> }).votes });
    else if (row.payload.type === "location" || row.payload.type === "contact") items.push({ kind: "share", message, payload: row.payload });
    else if (row.payload.type === "media") items.push({ kind: "media", message, payload: row.payload });
    else if (row.payload.type === "text") items.push({ kind: "text", message, payload: row.payload });
    else if (row.payload.type === "event" || row.payload.type === "meeting") items.push({ kind: "card", message, payload: row.payload });
  }
  if (lane === "All") {
    for (const m of messages) if (m.body.state !== "open") items.push({ kind: "closed", message: m, unreadable: m.body.state === "unreadable" });
  }
  return items.sort((a, b) => b.message.sentAt.localeCompare(a.message.sentAt));
}
export function featureMessages(messages: DisplayMessage[]): ContentMessage[] {
  return messages.flatMap(m => m.body.state === "open" && m.body.payload.type === "feature" && (!HIDDEN_TYPES.has(m.body.payload.content.type) || (m.delivery !== "failed" && m.delivery !== "sending")) ? [{ id: m.id, senderId: m.senderId, sentAt: m.sentAt, outgoing: m.outgoing, content: m.body.payload.content }] : []);
}

/** Time under the last bubble of a run: a new run starts when the sender changes or after a pause. */
export const GROUP_GAP_MS = 5 * 60 * 1000;
export function startsNewRun(newer: DisplayMessage | undefined, item: DisplayMessage): boolean {
  return !newer || newer.senderId !== item.senderId || Date.parse(newer.sentAt) - Date.parse(item.sentAt) > GROUP_GAP_MS;
}

export type DecisionSummary = {
  id: string;
  title: string;
  options: string[];
  votes: Record<string, number>;
  /** Index of my vote, or null. */
  mine: number | null;
  /** Index of the other person's vote, or null. */
  theirs: number | null;
  decided: boolean;
  /** "Jerry voted, your turn", "Waiting on Jerry", "No votes yet", or for a decided one the result. */
  status: string;
  /** For a decided decision: the winning option, or null when the two votes differ (a tie). */
  winner: number | null;
  sentAt: string;
};

/**
 * The Decisions page: every decision board in the conversation, oldest first, split into open and decided.
 * In a one-to-one conversation a decision is decided once both people have voted.
 */
export function buildDecisions(messages: DisplayMessage[], selfId: string, peerId: string | null, peerFirstName: string): { open: DecisionSummary[]; decided: DecisionSummary[] } {
  const open: DecisionSummary[] = [];
  const decided: DecisionSummary[] = [];
  for (const item of buildTimeline(messages, "All")) {
    if (item.kind !== "board") continue;
    const votes = item.votes;
    const mine = votes[selfId] ?? null;
    const theirs = peerId ? votes[peerId] ?? null : Object.entries(votes).find(([who]) => who !== selfId)?.[1] ?? null;
    const done = mine !== null && theirs !== null;
    const winner = done && mine === theirs ? mine : null;
    const status = done
      ? winner !== null ? "Decided" : "Decided, votes differ"
      : theirs !== null ? `${peerFirstName} voted, your turn`
      : mine !== null ? `Waiting on ${peerFirstName}`
      : "No votes yet";
    const summary: DecisionSummary = { id: item.message.id, title: item.payload.title, options: item.payload.options, votes, mine, theirs, decided: done, status, winner, sentAt: item.message.sentAt };
    (done ? decided : open).push(summary);
  }
  // Oldest first, so the list reads in the order the decisions were raised.
  return { open: open.reverse(), decided: decided.reverse() };
}
