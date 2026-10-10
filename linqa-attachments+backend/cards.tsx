import type { Attachment, PollAttachment } from "./types";
import { tally } from "./pipeline";

export function AttachmentCard({
  attachment,
  timeLabel,
  senderName,
  selfId,
  onVote,
  onRsvp,
  onAcceptMeeting,
  onWatchShare,
  onOpenMaps,
}: {
  attachment: Attachment;
  timeLabel: string;
  senderName: string;
  selfId: string;
  onVote?: (index: number) => void;
  onRsvp?: (value: "going" | "maybe" | "cant") => void;
  onAcceptMeeting?: () => void;
  onWatchShare?: () => void;
  onOpenMaps?: () => void;
}) {
  return (
    <article className={`linqa-msg linqa-msg--${attachment.kind}`}>
      {attachment.kind === "photos" && (
        <>
          <div className="linqa-album">
            {attachment.items.slice(0, 3).map((item) => (
              <div key={item.id} className="linqa-album__cell" />
            ))}
            {attachment.items.length > 3 && <div className="linqa-album__more">+{attachment.items.length - 3}</div>}
          </div>
          {attachment.caption && <p>{attachment.caption}</p>}
          <small>{timeLabel}, {attachment.items.length} photos</small>
        </>
      )}

      {attachment.kind === "location" && (
        <>
          <div className="linqa-map" />
          <div className="linqa-map__meta">
            <strong>{attachment.label}</strong>
            <span>{attachment.address}</span>
            <button onClick={onOpenMaps}>Open in Maps</button>
          </div>
          <small>{timeLabel}</small>
        </>
      )}

      {attachment.kind === "contact" && (
        <>
          <div className="linqa-contact">
            <b>{initials(attachment.name)}</b>
            <div>
              <strong>{attachment.name}</strong>
              <span>{attachment.role}</span>
            </div>
          </div>
          <div className="linqa-row">
            <button>Message</button>
            <button>Save</button>
          </div>
          <small>{timeLabel}, shared contact</small>
        </>
      )}

      {attachment.kind === "document" && (
        <>
          <div className="linqa-file">
            <b>PDF</b>
            <div>
              <strong>{attachment.name}</strong>
              <span>{attachment.pageCount ? `${attachment.pageCount} pages` : attachment.mime}</span>
            </div>
            <button aria-label="Download">↓</button>
          </div>
          <small>{timeLabel}</small>
        </>
      )}

      {attachment.kind === "poll" && (
        <PollCard poll={attachment} selfId={selfId} timeLabel={timeLabel} onVote={onVote} />
      )}

      {attachment.kind === "event" && (
        <>
          <div className="linqa-event">
            <div className="linqa-datebadge"><span>THU</span><strong>8</strong></div>
            <div>
              <em>Event</em>
              <strong>{attachment.title}</strong>
              <span>{attachment.start} to {attachment.end}{attachment.place ? `, ${attachment.place}` : ""}</span>
            </div>
          </div>
          <div className="linqa-row">
            {(["going", "maybe", "cant"] as const).map((value) => (
              <button key={value} className={attachment.rsvps[selfId] === value ? "is-on" : ""} onClick={() => onRsvp?.(value)}>
                {value === "going" ? "Going" : value === "maybe" ? "Maybe" : "Can't"}
              </button>
            ))}
          </div>
          <small>{senderName} is going</small>
          <small>{timeLabel}</small>
        </>
      )}

      {attachment.kind === "voice" && (
        <>
          <div className="linqa-voice">
            <button aria-label="Play">▶</button>
            <div className="linqa-wave">{attachment.waveform.slice(0, 24).map((h, i) => <span key={i} style={{ height: Math.max(6, h / 2) }} />)}</div>
            <span>{formatDuration(attachment.durationSec)}</span>
          </div>
          <small>{timeLabel}, voice message</small>
        </>
      )}

      {attachment.kind === "video" && (
        <>
          <div className="linqa-video">
            <button aria-label="Play">▶</button>
            <span>{formatDuration(attachment.durationSec)}</span>
          </div>
          <small>{timeLabel}, video clip</small>
        </>
      )}

      {attachment.kind === "ai_image" && (
        <>
          <div className="linqa-ai">
            <em>AI image</em>
            <div className="linqa-ai__canvas" />
            <p>Prompt: {attachment.prompt}</p>
          </div>
          <small>{timeLabel}</small>
        </>
      )}

      {attachment.kind === "meeting" && (
        <>
          <div className="linqa-meet">
            <strong>{attachment.title}</strong>
            <span>{attachment.date}, {attachment.starts}, {attachment.lengthMin} min</span>
            <div className="linqa-row">
              <button className="is-on" onClick={onAcceptMeeting}>Accept</button>
              <button>Suggest time</button>
            </div>
            <small>Encrypted video call. The join button appears {attachment.joinOpensMinBefore} minutes before.</small>
          </div>
          <small>{timeLabel}, meeting invite</small>
        </>
      )}

      {attachment.kind === "screen_share" && (
        <div className="linqa-livebar">
          <div>
            <b>LIVE</b>
            <strong>{attachment.presenterName} is sharing their screen</strong>
            <span>{attachment.live ? "Started 2 min ago" : "Ended"}</span>
          </div>
          <button onClick={onWatchShare}>Watch</button>
        </div>
      )}
    </article>
  );
}

function PollCard({
  poll,
  selfId,
  timeLabel,
  onVote,
}: {
  poll: PollAttachment;
  selfId: string;
  timeLabel: string;
  onVote?: (index: number) => void;
}) {
  const counts = tally(poll);
  const mine = new Set(poll.votes[selfId] ?? []);
  const voters = Object.values(poll.votes).filter((picks) => picks.length).length;
  return (
    <>
      <p className="linqa-kicker">Poll</p>
      <strong>{poll.question}</strong>
      {poll.options.map((option, index) => (
        <button key={option} className={mine.has(String(index)) ? "is-on" : ""} onClick={() => onVote?.(index)}>
          <span>{option}</span>
          <b>{counts[index]}</b>
        </button>
      ))}
      <small>
        {voters} vote{voters === 1 ? "" : "s"} so far. Tap an answer to vote.
        {poll.hideVoters ? " Totals only." : ""}
      </small>
      <small>{timeLabel}</small>
    </>
  );
}

export function ScreenShareStage({
  presenterName,
  elapsed,
  sharedTitle,
  encrypted,
  muted,
  onLeave,
}: {
  presenterName: string;
  elapsed: string;
  sharedTitle: string;
  encrypted: boolean;
  muted: boolean;
  onLeave: () => void;
}) {
  return (
    <section className="linqa-stage">
      <header>
        <b>LIVE</b>
        <div>
          <strong>{presenterName}'s screen</strong>
          <span>{elapsed}{encrypted ? ", encrypted" : ""}</span>
        </div>
      </header>
      <div className="linqa-stage__frame">
        <p>{sharedTitle}</p>
        <div className="linqa-stage__page" />
      </div>
      <footer>
        <button>{muted ? "Muted" : "Mic"}</button>
        <button>Full screen</button>
        <button>Chat</button>
        <button className="is-leave" onClick={onLeave}>Leave</button>
      </footer>
    </section>
  );
}

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
