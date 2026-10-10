// Run: npx tsx --test __tests__/fold.test.ts
// The thread renders a poll once; votes arrive later as separate hidden
// messages. These tests check that the fold the cards use picks them up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ContentMessage, MessageContent } from "../content/types";
import { decodeContent, encodeContent } from "../content/codec";
import { indexThread, rsvpsFor, votesFor } from "../render/threadIndex";
import { tallyPoll } from "../features/polls/pollModel";
import { rsvpTally } from "../features/schedule/scheduleModel";

let seq = 0;
// Every message goes through encode/decode, as it would after MLS decrypt.
const msg = (sender: string, content: MessageContent, at = `2026-10-09T10:${String(seq).padStart(2, "0")}:00Z`): ContentMessage => ({
  id: `m${++seq}`,
  senderId: sender,
  sentAt: at,
  outgoing: sender === "me",
  content: decodeContent(encodeContent(content))!,
});

const poll = {
  type: "poll" as const, pollId: "lunch", question: "Lunch after the walkthrough?", multi: false, hideVoters: false,
  options: [{ id: "yes", label: "Yes" }, { id: "quick", label: "Quick" }, { id: "no", label: "Can't" }],
};
const event = { type: "event" as const, eventId: "walk", title: "Walkthrough", startsAt: "2026-10-15T14:00:00Z", endsAt: "2026-10-15T15:30:00Z" };

function thread(): ContentMessage[] {
  seq = 0;
  return [
    msg("jerry", poll),
    msg("me", { type: "text", text: "Voting now" }),
    msg("me", { type: "poll_vote", pollId: "lunch", optionIds: ["yes"] }),
    msg("jerry", event),
    msg("jerry", { type: "poll_vote", pollId: "lunch", optionIds: ["quick"] }),
    msg("jerry", { type: "poll_vote", pollId: "lunch", optionIds: ["yes"] }), // Jerry changes his vote later
    msg("me", { type: "event_rsvp", eventId: "walk", response: "maybe" }),
    msg("me", { type: "event_rsvp", eventId: "walk", response: "going" }),
    msg("jerry", { type: "poll_vote", pollId: "other", optionIds: ["x"] }), // a different poll
    msg("me", { type: "live_session", sessionId: "s1", state: "started", screenShare: true }),
    msg("me", { type: "rtc_signal", sessionId: "s1", signal: { kind: "hangup" } }),
    msg("me", { type: "live_session", sessionId: "s1", state: "ended" }),
  ];
}

test("later votes fold into the poll card", () => {
  const ix = indexThread(thread());
  const t = tallyPoll(poll, votesFor(ix, "lunch"), "me", Date.parse("2026-10-09T12:00:00Z"));
  assert.deepEqual(t.counts, { yes: 2, quick: 0, no: 0 });
  assert.deepEqual(t.myVote, ["yes"]);
  assert.deepEqual(t.voters.yes.sort(), ["jerry", "me"]);
  assert.equal(votesFor(ix, "lunch").length, 3); // the other poll's vote isn't mixed in
});

test("a new vote arriving updates the totals", () => {
  const all = thread();
  const before = tallyPoll(poll, votesFor(indexThread(all), "lunch"), "me", 0);
  all.push(msg("jerry", { type: "poll_vote", pollId: "lunch", optionIds: ["no"] }, "2026-10-09T11:30:00Z"));
  const after = tallyPoll(poll, votesFor(indexThread(all), "lunch"), "me", 0);
  assert.equal(before.counts.yes, 2);
  assert.deepEqual(after.counts, { yes: 1, quick: 0, no: 1 });
});

test("later RSVPs fold into the event card", () => {
  const ix = indexThread(thread());
  assert.equal(rsvpTally(event, rsvpsFor(ix, "walk")).get("me"), "going");
});

test("hidden messages leave the thread and unread, but still count", () => {
  const ix = indexThread(thread());
  const types = ix.visible.map((m) => m.content.type);
  assert.deepEqual(types, ["poll", "text", "event", "live_session"]);
  assert.ok(ix.endedSessions.has("s1"));
  const all = thread();
  assert.equal(all.filter(ix.unreadEligible).length, 2); // Jerry's poll and event only
});

test("filtering hidden types before indexing would lose every vote", () => {
  // This is the wiring mistake the index exists to prevent.
  const filteredFirst = indexThread(thread().filter((m) => m.content.type !== "poll_vote"));
  assert.equal(votesFor(filteredFirst, "lunch").length, 0);
});
