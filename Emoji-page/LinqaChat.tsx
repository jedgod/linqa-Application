"use client";

import { useState } from "react";
import { EmojiPanel } from "./EmojiPanel";
import type { Sticker } from "./emoji-data";

type Message = {
  id: string;
  from: "me" | "them";
  text: string;
  time: string;
  kind?: "text" | "sticker" | "gif";
};

const SEED: Message[] = [
  { id: "1", from: "them", text: "Are we meeting tomorrow?", time: "9:12 AM" },
  { id: "2", from: "me", text: "Yes, see you at 10!", time: "9:14 AM" },
  { id: "3", from: "them", text: "Perfect!", time: "9:15 AM" },
];

export function LinqaChat() {
  const [draft, setDraft] = useState("See you tomorrow ");
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Message[]>(SEED);

  function push(partial: Omit<Message, "id" | "time" | "from">) {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        from: "me",
        time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        ...partial,
      },
    ]);
  }

  return (
    <div className="mx-auto flex h-[844px] w-[390px] flex-col overflow-hidden rounded-[36px] bg-[#F3EEFF] shadow-2xl ring-8 ring-slate-900">
      <header className="bg-[#1E1B4B] px-4 pb-3 pt-8 text-white">
        <div className="mb-2 flex justify-between text-xs">
          <span>9:41</span>
          <span>LTE</span>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="text-xl" aria-label="Back">
            ‹
          </button>
          <div className="relative grid h-10 w-10 place-items-center rounded-full bg-[#6D4AFF] text-sm font-bold">
            JM
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#1E1B4B]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">Jerry Mensah</p>
            <p className="text-xs text-emerald-300">Online</p>
          </div>
          <span aria-hidden>☎</span>
          <span aria-hidden>▣</span>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
              message.from === "me"
                ? "ml-auto bg-[#E4D9FF] text-slate-800"
                : "bg-white text-slate-800"
            }`}
          >
            <p>{message.text}</p>
            <p className="mt-1 text-right text-[10px] text-slate-400">{message.time}</p>
          </div>
        ))}
      </div>

      {open && (
        <EmojiPanel
          onPickEmoji={(emoji) => setDraft((value) => value + emoji)}
          onPickSticker={(sticker) =>
            push({ text: sticker.emoji ?? sticker.label, kind: "sticker" })
          }
          onPickGif={(gifId) => push({ text: `GIF · ${gifId}`, kind: "gif" })}
          onCreateSticker={() => push({ text: "Create sticker", kind: "sticker" })}
          onClose={() => setOpen(false)}
        />
      )}

      <form
        className="flex items-center gap-2 bg-white px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          push({ text: draft.trim() });
          setDraft("");
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="grid h-10 w-10 place-items-center rounded-full bg-[#6D4AFF] text-white"
          aria-label="Emoji"
        >
          ☺
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-10 flex-1 rounded-full bg-slate-100 px-4 text-sm outline-none"
        />
        <button type="button" aria-label="Attach" className="text-slate-500">
          📎
        </button>
        <button type="button" aria-label="Camera" className="text-slate-500">
          📷
        </button>
        <button
          type="submit"
          className="grid h-10 w-10 place-items-center rounded-full bg-orange-500 text-white"
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
