// Pure helpers for events and meetings: RSVP tallies, join windows, end times.

import { ContentMessage, EventContent, MeetingContent, RsvpResponse } from "../../content/types";

export const JOIN_EARLY_MIN = 10;
export const JOIN_LATE_GRACE_MIN = 15;

export function rsvpTally(event: EventContent, messages: ContentMessage[]): Map<string, RsvpResponse> {
  const latest = new Map<string, { at: number; id: string; r: RsvpResponse }>();
  for (const m of messages) {
    if (m.content.type !== "event_rsvp" || m.content.eventId !== event.eventId) continue;
    const at = Date.parse(m.sentAt);
    const prev = latest.get(m.senderId);
    if (!prev || at > prev.at || (at === prev.at && m.id > prev.id)) latest.set(m.senderId, { at, id: m.id, r: m.content.response });
  }
  return new Map([...latest].map(([k, v]) => [k, v.r]));
}

export function meetingEnd(m: MeetingContent): number {
  return Date.parse(m.startsAt) + m.durationMin * 60_000;
}

export function hasEventEnded(item: EventContent | MeetingContent, now = Date.now()): boolean {
  const start = Date.parse(item.startsAt);
  const end = item.type === "meeting" ? meetingEnd(item) : Date.parse(item.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= now;
}

/** All-day ranges follow local calendar days, including 23/25-hour DST days. */
export function eventRange(start: Date, minutes: number): { start: Date; end: Date } {
  if (minutes !== 0) return { start: new Date(start), end: new Date(start.getTime() + minutes * 60_000) };
  const day = new Date(start); day.setHours(0, 0, 0, 0);
  const next = new Date(day); next.setDate(next.getDate() + 1);
  return { start: day, end: new Date(next.getTime() - 1) };
}

export type JoinState =
  | { state: "upcoming"; opensInMin: number }
  | { state: "open" }
  | { state: "ended" };

export function joinState(m: MeetingContent, now = Date.now()): JoinState {
  const start = Date.parse(m.startsAt);
  const opens = start - JOIN_EARLY_MIN * 60_000;
  const closes = meetingEnd(m) + JOIN_LATE_GRACE_MIN * 60_000;
  if (now < opens) return { state: "upcoming", opensInMin: Math.ceil((opens - now) / 60_000) };
  if (now <= closes) return { state: "open" };
  return { state: "ended" };
}

export function whenLabel(startIso: string, endIso?: string, allDay?: boolean): string {
  const s = new Date(startIso);
  const date = s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (allDay) return `${date}, all day`;
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return endIso ? `${date}, ${t(s)} to ${t(new Date(endIso))}` : `${date}, ${t(s)}`;
}
