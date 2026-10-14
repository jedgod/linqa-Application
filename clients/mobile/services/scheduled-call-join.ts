// Joining a scheduled call from a card or from the "ready to join" banner.
//
// The server decides whether the window is open (join-token answers 409 outside it). Once it is, the call
// itself is an ordinary secure call: the organizer rings the invitee(s), an invitee rings the organizer.
//
// Two guards keep both sides from ringing each other:
//  - a join lock: after a join, the same call can't be joined again for JOIN_LOCK_MS (double taps, card + banner);
//  - an incoming check: an invitee whose organizer is already calling is told to answer, not to ring back.

import { getApiBaseUrl } from "../config/api";
import { CallsService, type ScheduledCall } from "./calls.service";
import { ChatInboxService } from "./chat-inbox.service";
import { startSecureCall, startSecureCallForPeer } from "./secure-call-rooms";
import { accessTokenProvider } from "./session";

export const JOIN_LOCK_MS = 10_000;

const lockedUntil = new Map<string, number>();
const listeners = new Set<() => void>();

/** True while a call was joined in the last JOIN_LOCK_MS. */
export const isJoinLocked = (callId: string, now = Date.now()) => (lockedUntil.get(callId) ?? 0) > now;

/** Lets a screen re-render when a lock starts or ends. Returns the unsubscribe. */
export function onJoinLockChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function lock(callId: string) {
  lockedUntil.set(callId, Date.now() + JOIN_LOCK_MS);
  listeners.forEach((l) => l());
  setTimeout(() => { lockedUntil.delete(callId); listeners.forEach((l) => l()); }, JOIN_LOCK_MS + 50);
}

const services = () => {
  const token = () => accessTokenProvider.getAccessToken();
  return { calls: new CallsService(getApiBaseUrl(), token), inbox: new ChatInboxService(getApiBaseUrl(), token) };
};

/** The group chat made of exactly the organizer and the invitees, if there is one. Ringing a larger group would ring people who were not invited. */
async function exactGroupChat(call: ScheduledCall, inbox: ChatInboxService): Promise<string | null> {
  const wanted = new Set([call.organizerUserId, ...call.participantUserIds]);
  const data = await inbox.inbox("all");
  const match = data.conversations.find((c) => c.isGroup && c.memberUserIds?.length === wanted.size && c.memberUserIds.every((id) => wanted.has(id)));
  return match?.conversationId ?? null;
}

function unlock(callId: string) { lockedUntil.delete(callId); listeners.forEach((l) => l()); }

/** Returns a plain-language problem, or null when the call has started. */
export async function joinScheduledCallNow(call: ScheduledCall): Promise<string | null> {
  if (isJoinLocked(call.id)) return "Your call is already connecting. Give it a few seconds.";
  lock(call.id);
  let problem: string | null;
  try {
    problem = await attempt(call);
  } catch (error) {
    problem = error instanceof Error ? error.message : "Unable to start the call.";
  }
  // Nothing started, so there is nothing to protect from a second ring: let them try again straight away.
  if (problem) unlock(call.id);
  return problem;
}

async function attempt(call: ScheduledCall): Promise<string | null> {
  const { calls, inbox } = services();
  try {
    await calls.joinScheduledCall(call.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /NOT_JOINABLE/i.test(message) ? "This call isn't open yet. You can join 10 minutes before it starts." : message || "Unable to join that call.";
  }

  if (!call.isOrganizer) {
    // The organizer rings first. If that ring is already here, answering it is the join.
    const ringing = await calls.incoming().catch(() => []);
    if (ringing.some((r) => r.callerUserId === call.organizerUserId)) return `${call.organizerName} is already calling you. Answer the incoming call.`;
    return startSecureCallForPeer(call.organizerUserId, call.callType);
  }
  if (call.participantUserIds.length === 1) return startSecureCallForPeer(call.participantUserIds[0]!, call.callType);
  const conversationId = await exactGroupChat(call, inbox);
  if (!conversationId) return "To start a call with this group, create a group chat with exactly these people first.";
  return startSecureCall(conversationId, call.callType, call.participantUserIds);
}

/** Minutes until a scheduled call starts (negative once it has). */
export const minutesUntil = (call: ScheduledCall, now = Date.now()) => (Date.parse(call.scheduledFor) - now) / 60_000;

/** The banner opens this many minutes before the start. */
export const ALERT_LEAD_MINUTES = 5;
