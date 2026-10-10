// Votes are ordinary encrypted messages (poll_vote). Each person's latest
// vote counts; votes after the poll closes, for unknown options, or from a
// poll the voter can't see are ignored. Everyone computes the same totals
// from the same messages, so no server ever needs to see a ballot.

import { ContentMessage, PollContent, PollVoteContent } from "../../content/types";

export interface PollTally {
  counts: Record<string, number>;
  voters: Record<string, string[]>; // optionId -> senderIds (empty when hideVoters)
  totalVoters: number;
  myVote: string[];
  closed: boolean;
}

export function tallyPoll(poll: PollContent, messages: ContentMessage[], selfId: string, now = Date.now()): PollTally {
  const valid = new Set(poll.options.map((o) => o.id));
  const closesAt = poll.closesAt ? Date.parse(poll.closesAt) : Infinity;

  // Latest vote per sender (by sentAt, then id for a stable tie-break).
  const latest = new Map<string, { at: number; id: string; vote: PollVoteContent }>();
  for (const m of messages) {
    if (m.content.type !== "poll_vote" || m.content.pollId !== poll.pollId) continue;
    const at = Date.parse(m.sentAt);
    if (!(at <= closesAt)) continue;
    const prev = latest.get(m.senderId);
    if (!prev || at > prev.at || (at === prev.at && m.id > prev.id)) latest.set(m.senderId, { at, id: m.id, vote: m.content });
  }

  const counts: Record<string, number> = Object.fromEntries(poll.options.map((o) => [o.id, 0]));
  const voters: Record<string, string[]> = Object.fromEntries(poll.options.map((o) => [o.id, []]));
  let totalVoters = 0;
  let myVote: string[] = [];

  for (const [sender, { vote }] of latest) {
    let picks = [...new Set(vote.optionIds.filter((id) => valid.has(id)))];
    if (!poll.multi) picks = picks.slice(0, 1);
    if (!picks.length) continue; // retracted
    totalVoters++;
    for (const id of picks) {
      counts[id]++;
      if (!poll.hideVoters) voters[id].push(sender);
    }
    if (sender === selfId) myVote = picks;
  }

  return { counts, voters, totalVoters, myVote, closed: now > closesAt };
}

/** What a tap on an option should send. */
export function nextVote(poll: PollContent, current: string[], tapped: string): string[] {
  if (!poll.multi) return current.length === 1 && current[0] === tapped ? [] : [tapped];
  return current.includes(tapped) ? current.filter((id) => id !== tapped) : [...current, tapped];
}

export function pollStatus(t: PollTally, peerName: string): string {
  if (t.closed) return t.totalVoters === 1 ? "Closed. 1 vote" : `Closed. ${t.totalVoters} votes`;
  if (t.myVote.length && t.totalVoters < 2) return `Waiting on ${peerName}`;
  if (!t.myVote.length) return t.totalVoters ? `${t.totalVoters} voted. Tap an answer to vote.` : "Tap an answer to vote.";
  return t.totalVoters === 1 ? "1 vote. Tap again to change." : `${t.totalVoters} votes. Tap again to change.`;
}
