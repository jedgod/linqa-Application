// Folds the decrypted thread once per update. Votes, RSVPs and session-end
// messages are hidden from the thread but still decide what the poll, event
// and live-session cards show, so they are grouped here by pollId / eventId /
// sessionId and handed to the right card.
//
// Build the index from ALL decrypted messages, before hiding anything.
// Hiding first would leave every poll at zero votes.

import { ContentMessage, HIDDEN_TYPES } from "../content/types";

export interface ThreadIndex {
  /** What the thread shows, in the order given. */
  visible: ContentMessage[];
  /** poll_vote messages grouped by pollId. */
  votesByPoll: Map<string, ContentMessage[]>;
  /** event_rsvp messages grouped by eventId. */
  rsvpsByEvent: Map<string, ContentMessage[]>;
  /** Live sessions that have an "ended" message. */
  endedSessions: Set<string>;
  /** Counts toward unread: everything visible that someone else sent. */
  unreadEligible: (m: ContentMessage) => boolean;
}

const EMPTY: ContentMessage[] = [];

export function indexThread(all: ContentMessage[]): ThreadIndex {
  const visible: ContentMessage[] = [];
  const votesByPoll = new Map<string, ContentMessage[]>();
  const rsvpsByEvent = new Map<string, ContentMessage[]>();
  const endedSessions = new Set<string>();

  for (const m of all) {
    const c = m.content;
    if (c.type === "poll_vote") push(votesByPoll, c.pollId, m);
    else if (c.type === "event_rsvp") push(rsvpsByEvent, c.eventId, m);
    else if (c.type === "live_session" && c.state === "ended") endedSessions.add(c.sessionId);

    // "Ended" markers fold into the started banner instead of showing twice.
    const hiddenEnd = c.type === "live_session" && c.state === "ended";
    if (!HIDDEN_TYPES.has(c.type) && !hiddenEnd) visible.push(m);
  }

  return {
    visible,
    votesByPoll,
    rsvpsByEvent,
    endedSessions,
    unreadEligible: (m) => !m.outgoing && !HIDDEN_TYPES.has(m.content.type),
  };
}

export const votesFor = (ix: ThreadIndex, pollId: string) => ix.votesByPoll.get(pollId) ?? EMPTY;
export const rsvpsFor = (ix: ThreadIndex, eventId: string) => ix.rsvpsByEvent.get(eventId) ?? EMPTY;

function push(map: Map<string, ContentMessage[]>, key: string, m: ContentMessage) {
  const list = map.get(key);
  if (list) list.push(m);
  else map.set(key, [m]);
}
