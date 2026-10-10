import { useMemo, useState } from "react";
import { SHARE_ACTIONS, type AttachmentKind } from "./types";

type Action = AttachmentKind | "edit_photo";

const ICONS: Record<Action, string> = {
  photos: "image",
  edit_photo: "crop",
  document: "file",
  location: "pin",
  contact: "user",
  poll: "bars",
  event: "cal",
  meeting: "video",
  voice: "mic",
  video: "record",
  screen_share: "screen",
  ai_image: "spark",
};

export function ShareSheet({
  peerName,
  recentThumbs,
  onClose,
  onPick,
}: {
  peerName: string;
  recentThumbs: string[];
  onClose: () => void;
  onPick: (action: Action) => void;
}) {
  return (
    <div className="linqa-sheet" role="dialog" aria-label={`Share with ${peerName}`}>
      <button className="linqa-sheet__grabber" onClick={onClose} aria-label="Close" />
      <header className="linqa-sheet__head">
        <h2>Share with {peerName}</h2>
        <button className="linqa-text-btn">Customize</button>
      </header>
      <div className="linqa-recent">
        {recentThumbs.map((src) => (
          <button key={src} className="linqa-recent__thumb" onClick={() => onPick("photos")}>
            <img src={src} alt="" />
          </button>
        ))}
        <button className="linqa-recent__all" onClick={() => onPick("photos")}>
          All photos
        </button>
      </div>
      <div className="linqa-grid">
        {SHARE_ACTIONS.map((action) => (
          <button key={action.kind} className="linqa-grid__item" onClick={() => onPick(action.kind)}>
            <span className={`linqa-grid__icon ${action.kind === "ai_image" ? "is-exception" : ""}`}>
              <Glyph name={ICONS[action.kind]} />
            </span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
      <p className="linqa-seal-note">
        <Glyph name="lock" /> Everything here is encrypted on your phone before it's sent. AI image
        prompts are the one exception: they go to the image service first.
      </p>
    </div>
  );
}

export function PollComposer({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (draft: {
    question: string;
    options: string[];
    allowMultiple: boolean;
    hideVoters: boolean;
    closeVoting: "1h" | "1d" | "never";
  }) => void;
}) {
  const [question, setQuestion] = useState("Lunch after the walkthrough?");
  const [options, setOptions] = useState(["Yes, somewhere nearby", "Yes, but quick", "Can't this time"]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [hideVoters, setHideVoters] = useState(false);
  const [closeVoting, setCloseVoting] = useState<"1h" | "1d" | "never">("1h");
  const ready = question.trim().length > 0 && options.filter((o) => o.trim()).length >= 2;

  return (
    <section className="linqa-composer">
      <header className="linqa-composer__bar">
        <button onClick={onCancel}>Cancel</button>
        <h2>New poll</h2>
        <span />
      </header>
      <label className="linqa-field">
        <span>Question</span>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <p className="linqa-label">Answers</p>
      {options.map((option, index) => (
        <div className="linqa-option" key={index}>
          <input
            value={option}
            onChange={(e) => setOptions(options.map((item, i) => (i === index ? e.target.value : item)))}
          />
          <button aria-label="Remove answer" onClick={() => setOptions(options.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      <button className="linqa-add" onClick={() => setOptions([...options, ""])}>
        + Add an answer
      </button>
      <Toggle label="Allow more than one answer" hint="Each person can pick several" on={allowMultiple} setOn={setAllowMultiple} />
      <Toggle label="Hide who voted" hint="Show totals only" on={hideVoters} setOn={setHideVoters} />
      <div className="linqa-card">
        <p>Close voting</p>
        <div className="linqa-chips">
          {(
            [
              ["1h", "In 1 hour"],
              ["1d", "In 1 day"],
              ["never", "Never"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} className={closeVoting === value ? "is-on" : ""} onClick={() => setCloseVoting(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <button className="linqa-send" disabled={!ready} onClick={() => onSend({ question, options, allowMultiple, hideVoters, closeVoting })}>
        Send poll
      </button>
    </section>
  );
}

export function MeetingComposer({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (draft: {
    mode: "meeting" | "event";
    title: string;
    date: string;
    starts: string;
    lengthMin: 15 | 30 | 45 | 60;
    note: string;
    remind: boolean;
  }) => void;
}) {
  const [mode, setMode] = useState<"meeting" | "event">("meeting");
  const [title, setTitle] = useState(mode === "meeting" ? "Plan review call" : "Site walkthrough");
  const [date, setDate] = useState("Fri, Oct 9");
  const [starts, setStarts] = useState("2:00 PM");
  const [lengthMin, setLengthMin] = useState<15 | 30 | 45 | 60>(30);
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState(true);

  return (
    <section className="linqa-composer">
      <header className="linqa-composer__bar">
        <button onClick={onCancel}>Cancel</button>
        <h2>Schedule a meeting</h2>
        <span />
      </header>
      <div className="linqa-seg">
        <button className={mode === "meeting" ? "is-on" : ""} onClick={() => setMode("meeting")}>Meeting</button>
        <button className={mode === "event" ? "is-on" : ""} onClick={() => setMode("event")}>Event</button>
      </div>
      <label className="linqa-field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="linqa-split">
        <label className="linqa-field"><span>Date</span><input value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="linqa-field"><span>Starts</span><input value={starts} onChange={(e) => setStarts(e.target.value)} /></label>
      </div>
      <div className="linqa-card">
        <p>Length</p>
        <div className="linqa-chips">
          {([15, 30, 45, 60] as const).map((value) => (
            <button key={value} className={lengthMin === value ? "is-on" : ""} onClick={() => setLengthMin(value)}>
              {value === 60 ? "1 hr" : `${value} min`}
            </button>
          ))}
        </div>
      </div>
      {mode === "meeting" && (
        <div className="linqa-callout">
          <Glyph name="video" />
          <div>
            <strong>Encrypted video call in Linqa</strong>
            <p>Join opens 10 minutes before the start</p>
          </div>
        </div>
      )}
      <Toggle label="Remind us both" hint="15 minutes before" on={remind} setOn={setRemind} />
      <label className="linqa-field">
        <span>Note (optional)</span>
        <input placeholder="Agenda or what to bring" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className="linqa-send" onClick={() => onSend({ mode, title, date, starts, lengthMin, note, remind })}>
        Send meeting invite
      </button>
    </section>
  );
}

export function VoiceRecorder({
  onDiscard,
  onSend,
}: {
  onDiscard: () => void;
  onSend: (clip: { durationSec: number; waveform: number[]; kind: "voice" | "video" }) => void;
}) {
  const [tab, setTab] = useState<"voice" | "video">("voice");
  const [seconds, setSeconds] = useState(18);
  const [paused, setPaused] = useState(false);
  const waveform = useMemo(() => Array.from({ length: 28 }, (_, i) => 8 + ((i * 17) % 22)), []);

  return (
    <section className="linqa-recorder">
      <header>
        <button onClick={onDiscard} aria-label="Close">×</button>
        <div className="linqa-seg">
          <button className={tab === "voice" ? "is-on" : ""} onClick={() => setTab("voice")}>Voice</button>
          <button className={tab === "video" ? "is-on" : ""} onClick={() => setTab("video")}>Video</button>
        </div>
      </header>
      <p className="linqa-rec">{paused ? "Paused" : "Recording"}</p>
      <p className="linqa-timer">0:{String(seconds).padStart(2, "0")}</p>
      <div className="linqa-wave" aria-hidden>
        {waveform.map((h, i) => (
          <span key={i} style={{ height: h }} />
        ))}
      </div>
      <p className="linqa-muted">
        You can listen before sending. Voice messages are encrypted on your phone.
      </p>
      <footer>
        <button onClick={onDiscard} aria-label="Discard">Trash</button>
        <button onClick={() => setPaused((v) => !v)} aria-label={paused ? "Resume" : "Pause"}>
          {paused ? "Play" : "Pause"}
        </button>
        <button className="linqa-go" onClick={() => onSend({ durationSec: seconds, waveform, kind: tab })}>
          Send
        </button>
      </footer>
    </section>
  );
}

export function AiImageComposer({
  peerName,
  onBack,
  onSend,
}: {
  peerName: string;
  onBack: () => void;
  onSend: (draft: { prompt: string; style: "photo" | "watercolor" | "sketch" | "diagram"; chosenIndex: number }) => void;
}) {
  const [prompt, setPrompt] = useState("Watercolor sketch of the finished lobby, morning light");
  const [style, setStyle] = useState<"photo" | "watercolor" | "sketch" | "diagram">("watercolor");
  const [chosen, setChosen] = useState(1);
  const tiles = ["#d5dee8", "#c5d0dc", "#e6d7c3", "#d5e3dc"];

  return (
    <section className="linqa-composer">
      <header className="linqa-composer__bar">
        <button onClick={onBack}>‹</button>
        <h2>Create an image</h2>
        <span />
      </header>
      <p className="linqa-warn">
        Your prompt goes to the image service to make the picture, so it isn't end-to-end encrypted.
        The image you pick is encrypted before {peerName} gets it.
      </p>
      <label className="linqa-field">
        <span>Describe the image</span>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="linqa-chips">
        {(["photo", "watercolor", "sketch", "diagram"] as const).map((value) => (
          <button key={value} className={style === value ? "is-on" : ""} onClick={() => setStyle(value)}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <div className="linqa-tiles">
        {tiles.map((color, index) => (
          <button key={color} style={{ background: color }} className={chosen === index ? "is-on" : ""} onClick={() => setChosen(index)} />
        ))}
      </div>
      <footer className="linqa-split">
        <button className="linqa-ghost">Try again</button>
        <button className="linqa-send" onClick={() => onSend({ prompt, style, chosenIndex: chosen })}>
          Send to {peerName}
        </button>
      </footer>
    </section>
  );
}

export function PhotoEditor({
  onCancel,
  onSend,
}: {
  onCancel: () => void;
  onSend: (caption: string) => void;
}) {
  const [ratio, setRatio] = useState("free");
  const [caption, setCaption] = useState("");
  return (
    <section className="linqa-editor">
      <header>
        <button onClick={onCancel}>Cancel</button>
        <h2>Edit photo</h2>
        <button>Reset</button>
      </header>
      <div className={`linqa-crop is-${ratio}`} />
      <div className="linqa-chips">
        {["free", "square", "4:3", "16:9"].map((value) => (
          <button key={value} className={ratio === value ? "is-on" : ""} onClick={() => setRatio(value)}>
            {value === "free" ? "Free" : value === "square" ? "Square" : value}
          </button>
        ))}
      </div>
      <div className="linqa-tools">
        {["Crop", "Rotate", "Draw", "Text", "Blur faces"].map((tool) => (
          <button key={tool} className={tool === "Crop" ? "is-on" : ""}>{tool}</button>
        ))}
      </div>
      <footer>
        <input placeholder="Add a caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
        <button className="linqa-send" onClick={() => onSend(caption)}>Send</button>
      </footer>
    </section>
  );
}

function Toggle({ label, hint, on, setOn }: { label: string; hint: string; on: boolean; setOn: (v: boolean) => void }) {
  return (
    <button className="linqa-toggle" onClick={() => setOn(!on)} aria-pressed={on}>
      <span><strong>{label}</strong><small>{hint}</small></span>
      <i className={on ? "is-on" : ""} />
    </button>
  );
}

function Glyph({ name }: { name: string }) {
  return <span className={`linqa-glyph linqa-glyph--${name}`} aria-hidden />;
}
