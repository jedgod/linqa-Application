import type {
  AiImageAttachment,
  Attachment,
  CloseVoting,
  EventAttachment,
  ImageStyle,
  MeetingAttachment,
  MeetingLengthMin,
  OutboundEnvelope,
  PollAttachment,
} from "./types";
import { sealJson } from "./seal";

export interface SendContext {
  threadId: string;
  senderId: string;
  threadKey: string;
  peerName: string;
}

export interface ImageService {
  generate(input: { prompt: string; style: ImageStyle }): Promise<{
    mime: string;
    bytes: ArrayBuffer;
    previews: ArrayBuffer[];
  }>;
}

const id = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `linqa_${Date.now()}_${Math.random().toString(16).slice(2)}`;

/**
 * Single exit for every share-sheet action.
 * 1. Build the attachment the thread card expects.
 * 2. If AI image: prompt goes to the image service first (not E2EE).
 * 3. Seal the attachment JSON (and any embedded bytes as base64) with the thread key.
 * 4. Return an envelope the transport can put on the Linqa relay.
 */
export async function buildEnvelope(
  ctx: SendContext,
  attachment: Attachment,
): Promise<OutboundEnvelope> {
  const sealedPayload = await sealJson(
    {
      ...attachment,
      bytes: "bytes" in attachment && attachment.bytes ? bufferMark(attachment.bytes) : undefined,
      items:
        attachment.kind === "photos"
          ? attachment.items.map((item) => ({ ...item, bytes: bufferMark(item.bytes) }))
          : undefined,
      image: attachment.kind === "ai_image" ? bufferMark(attachment.image) : undefined,
    },
    ctx.threadKey,
  );

  return {
    id: id(),
    threadId: ctx.threadId,
    senderId: ctx.senderId,
    createdAt: new Date().toISOString(),
    attachment,
    sealedPayload,
    cleartextException: attachment.kind === "ai_image" ? "ai_prompt" : undefined,
  };
}

function bufferMark(buffer: ArrayBuffer): { byteLength: number } {
  return { byteLength: buffer.byteLength };
}

export function draftPoll(input: {
  question: string;
  options: string[];
  allowMultiple: boolean;
  hideVoters: boolean;
  closeVoting: CloseVoting;
}): PollAttachment {
  const closesAt =
    input.closeVoting === "1h"
      ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
      : input.closeVoting === "1d"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        : undefined;
  return {
    kind: "poll",
    question: input.question.trim(),
    options: input.options.map((option) => option.trim()).filter(Boolean),
    allowMultiple: input.allowMultiple,
    hideVoters: input.hideVoters,
    closeVoting: input.closeVoting,
    votes: {},
    closesAt,
  };
}

export function draftMeeting(input: {
  title: string;
  date: string;
  starts: string;
  lengthMin: MeetingLengthMin;
  note?: string;
  remind: boolean;
}): MeetingAttachment {
  return {
    kind: "meeting",
    title: input.title.trim() || "Plan review call",
    date: input.date,
    starts: input.starts,
    lengthMin: input.lengthMin,
    note: input.note?.trim() || undefined,
    remind: input.remind,
    remindLeadMin: 15,
    joinOpensMinBefore: 10,
    callId: id(),
    status: "pending",
  };
}

export function draftEvent(input: {
  title: string;
  dateLabel: string;
  start: string;
  end: string;
  place?: string;
  senderId: string;
}): EventAttachment {
  return {
    kind: "event",
    title: input.title.trim(),
    date: input.dateLabel,
    start: input.start,
    end: input.end,
    place: input.place,
    rsvps: { [input.senderId]: "going" },
  };
}

export async function createAiImage(
  service: ImageService,
  input: { prompt: string; style: ImageStyle; chosenIndex: number },
): Promise<AiImageAttachment> {
  const generated = await service.generate({ prompt: input.prompt, style: input.style });
  const chosen = generated.previews[input.chosenIndex] ?? generated.bytes;
  return {
    kind: "ai_image",
    prompt: input.prompt.trim(),
    style: input.style,
    image: chosen,
    mime: generated.mime,
    promptLeftDevice: true,
  };
}

export function vote(
  poll: PollAttachment,
  voterId: string,
  optionIndex: number,
): PollAttachment {
  if (poll.closesAt && new Date(poll.closesAt).getTime() < Date.now()) return poll;
  const current = poll.votes[voterId] ?? [];
  const key = String(optionIndex);
  const next = poll.allowMultiple
    ? current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key]
    : current[0] === key
      ? []
      : [key];
  return { ...poll, votes: { ...poll.votes, [voterId]: next } };
}

export function tally(poll: PollAttachment): number[] {
  const counts = poll.options.map(() => 0);
  Object.values(poll.votes).forEach((picks) => {
    picks.forEach((pick) => {
      const index = Number(pick);
      if (counts[index] !== undefined) counts[index] += 1;
    });
  });
  return counts;
}
