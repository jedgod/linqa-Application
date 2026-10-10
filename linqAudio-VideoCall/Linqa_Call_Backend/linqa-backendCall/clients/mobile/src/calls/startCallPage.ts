import type { CallService } from "../services/CallService";

/** Opens the voice or video page only after the backend accepts the call. */
export async function startCallPage(input: {
  calls: CallService;
  peerUserId: string;
  callType: "AUDIO" | "VIDEO";
  privacyMode: "STANDARD" | "RELAY_ONLY";
}) {
  const created = await input.calls.create({
    peerUserId: input.peerUserId,
    callType: input.callType,
    privacyMode: input.privacyMode,
  });
  return {
    callId: created.id,
    page: input.callType === "AUDIO" ? "VOICE" : "VIDEO",
    privacy: input.privacyMode === "RELAY_ONLY" ? "Relay only" : "End-to-end",
  };
}
