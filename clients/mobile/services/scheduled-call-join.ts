// Joining a scheduled call from a card or from the "ready to join" banner.
//
// The server decides whether the window is open (join-token answers 409 outside it). Once it is, the call
// itself is an ordinary secure call: the organizer rings the invitee, an invitee rings the organizer.

import { getApiBaseUrl } from "../config/api";
import { CallsService, type ScheduledCall } from "./calls.service";
import { startSecureCallForPeer } from "./secure-call-rooms";
import { accessTokenProvider } from "./session";

/** Returns a plain-language problem, or null when the call has started. */
export async function joinScheduledCallNow(call: ScheduledCall): Promise<string | null> {
  const target = call.isOrganizer ? (call.participantUserIds.length === 1 ? call.participantUserIds[0] : null) : call.organizerUserId;
  if (!target) return "Calls with several people can't be started from here yet. Call each person from their chat.";
  try {
    const service = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    await service.joinScheduledCall(call.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /NOT_JOINABLE/i.test(message) ? "This call isn't open yet. You can join 10 minutes before it starts." : message || "Unable to join that call.";
  }
  return startSecureCallForPeer(target, call.callType);
}

/** Minutes until a scheduled call starts (negative once it has). */
export const minutesUntil = (call: ScheduledCall, now = Date.now()) => (Date.parse(call.scheduledFor) - now) / 60_000;

/** The banner opens this many minutes before the start. */
export const ALERT_LEAD_MINUTES = 5;
