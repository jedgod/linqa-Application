"use client";

import { useMemo, useState } from "react";
import {
  AI_PROMPTS,
  AI_STYLES,
  EMOJI_CATEGORIES,
  FAVORITE_STICKERS,
  GIF_CHIPS,
  REACTION_GIFS,
  RECENT_STICKERS,
  SKIN_TONES,
  STICKER_PACKS,
  TRENDING_GIFS,
  applySkinTone,
  filterEmoji,
  type AiSticker,
  type SkinTone,
  type Sticker,
} from "./emoji-data";

type PanelTab = "emoji" | "gifs" | "stickers" | "ai";

type EmojiPanelProps = {
  onPickEmoji?: (emoji: string) => void;
  onPickSticker?: (sticker: Sticker) => void;
  onPickGif?: (gifId: string) => void;
  onCreateSticker?: () => void;
  onGenerateAi?: (prompt: string, style: string) => Promise<AiSticker[]>;
  onPickAi?: (sticker: AiSticker) => void;
  onClose?: () => void;
};

export function EmojiPanel({
  onPickEmoji,
  onPickSticker,
  onPickGif,
  onCreateSticker,
  onGenerateAi,
  onPickAi,
  onClose,
}: EmojiPanelProps) {
  const [tab, setTab] = useState<PanelTab>("emoji");
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<SkinTone>(0);
  const [toneTarget, setToneTarget] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("recent");
  const [gifChip, setGifChip] = useState<(typeof GIF_CHIPS)[number]>("Trending");
  const [pack, setPack] = useState("recent");

  const categories = useMemo(() => filterEmoji(query), [query]);

  function insertEmoji(base: string, tonable?: boolean) {
    onPickEmoji?.(tonable ? applySkinTone(base, tone) : base);
    setToneTarget(null);
  }

  return (
    <section className="flex max-h-[560px] flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(47,32,92,0.12)]">
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200" />
      <header className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="text-[22px] font-bold tracking-tight text-slate-900">
          {tab === "emoji" ? "Emojis" : tab === "gifs" ? "GIFs" : tab === "ai" ? "AI stickers" : "Stickers"}
        </h2>
        <div className="flex items-center gap-2">
          {tab === "emoji" && (
            <div className="flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1">
              <span className="text-lg" aria-hidden>
                {applySkinTone("✋", tone)}
              </span>
              {SKIN_TONES.slice(1).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Skin tone ${item.id}`}
                  onClick={() => setTone(item.id)}
                  className={`h-4 w-4 rounded-full ring-2 ring-offset-1 ${
                    tone === item.id ? "ring-violet-500" : "ring-transparent"
                  }`}
                  style={{ background: item.swatch }}
                />
              ))}
            </div>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <label className="mx-4 mb-3 flex items-center gap-2 rounded-2xl bg-[#F4F1FB] px-3 py-2.5 text-slate-500">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            tab === "emoji"
              ? "Search emojis"
              : tab === "gifs"
                ? "Search GIFs"
                : tab === "ai"
                  ? "Describe a sticker"
                  : "Search stickers"
          }
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
        />
      </label>

      <div className="mx-4 mb-3 grid grid-cols-4 rounded-full bg-[#F4F1FB] p-1 text-sm font-semibold text-slate-500">
        {(
          [
            ["emoji", "Emoji"],
            ["gifs", "GIFs"],
            ["stickers", "Stickers"],
            ["ai", "AI"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setQuery("");
            }}
            className={`rounded-full py-2 ${
              tab === id ? "bg-[#6D4AFF] text-white shadow-sm" : ""
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "emoji" && (
        <EmojiTab
          categories={categories}
          activeCategory={activeCategory}
          tone={tone}
          toneTarget={toneTarget}
          onCategory={(id) => {
            setActiveCategory(id);
            document.getElementById(`emoji-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onPick={insertEmoji}
          onLongPress={(emoji) => setToneTarget(emoji)}
          onTone={(next) => {
            setTone(next);
            if (toneTarget) insertEmoji(toneTarget, true);
          }}
        />
      )}
      {tab === "gifs" && (
        <GifTab
          chip={gifChip}
          query={query}
          onChip={setGifChip}
          onPick={(id) => onPickGif?.(id)}
        />
      )}
      {tab === "stickers" && (
        <StickerTab
          pack={pack}
          onPack={setPack}
          onCreate={onCreateSticker}
          onPick={(sticker) => onPickSticker?.(sticker)}
        />
      )}
      {tab === "ai" && (
        <AiTab
          seed={query}
          onGenerate={onGenerateAi}
          onPick={(sticker) => onPickAi?.(sticker)}
        />
      )}
    </section>
  );
}

function EmojiTab({
  categories,
  activeCategory,
  tone,
  toneTarget,
  onCategory,
  onPick,
  onLongPress,
  onTone,
}: {
  categories: typeof EMOJI_CATEGORIES;
  activeCategory: string;
  tone: SkinTone;
  toneTarget: string | null;
  onCategory: (id: string) => void;
  onPick: (emoji: string, tonable?: boolean) => void;
  onLongPress: (emoji: string) => void;
  onTone: (tone: SkinTone) => void;
}) {
  return (
    <>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {EMOJI_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onCategory(category.id)}
            className={`grid h-9 min-w-9 place-items-center rounded-full text-slate-500 ${
              activeCategory === category.id
                ? "bg-violet-50 text-[#6D4AFF] shadow-[inset_0_-2px_0_#6D4AFF]"
                : ""
            }`}
            aria-label={category.label}
          >
            <CategoryIcon id={category.icon} />
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {categories.map((category) => (
          <div key={category.id} id={`emoji-${category.id}`} className="mb-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-500">{category.label}</h3>
            <div className="grid grid-cols-7 gap-1">
              {category.items.map((item) => (
                <button
                  key={`${category.id}-${item.name}`}
                  type="button"
                  title={item.name}
                  onClick={() => onPick(item.emoji, item.tonable)}
                  onContextMenu={(event) => {
                    if (!item.tonable) return;
                    event.preventDefault();
                    onLongPress(item.emoji);
                  }}
                  className="relative grid h-10 place-items-center rounded-xl text-[26px] hover:bg-violet-50"
                >
                  {item.tonable ? applySkinTone(item.emoji, tone) : item.emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
        {toneTarget && (
          <div className="sticky bottom-2 mx-auto flex w-fit gap-1 rounded-2xl bg-white px-3 py-2 shadow-lg ring-1 ring-slate-100">
            {SKIN_TONES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTone(item.id)}
                className="text-2xl"
              >
                {applySkinTone(toneTarget, item.id)}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function GifTab({
  chip,
  query,
  onChip,
  onPick,
}: {
  chip: (typeof GIF_CHIPS)[number];
  query: string;
  onChip: (chip: (typeof GIF_CHIPS)[number]) => void;
  onPick: (id: string) => void;
}) {
  const tiles = [...TRENDING_GIFS, ...REACTION_GIFS].filter((gif) =>
    gif.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
      <div className="mb-3 flex gap-4 overflow-x-auto text-sm font-semibold text-slate-500">
        {GIF_CHIPS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onChip(item)}
            className={`shrink-0 pb-1 ${
              chip === item ? "border-b-2 border-[#6D4AFF] text-slate-900" : ""
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{chip}</h3>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((gif) => (
          <button
            key={gif.id}
            type="button"
            onClick={() => onPick(gif.id)}
            className="relative flex h-24 items-end overflow-hidden rounded-2xl p-2 text-left text-xs font-semibold text-white"
            style={{ background: gif.tint }}
          >
            <span className="absolute inset-0 grid place-items-center text-4xl">{gif.emoji}</span>
            <span className="relative rounded-full bg-black/35 px-2 py-0.5">{gif.title}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">Powered by GIPHY</p>
    </div>
  );
}

function StickerTab({
  pack,
  onPack,
  onCreate,
  onPick,
}: {
  pack: string;
  onPack: (id: string) => void;
  onCreate?: () => void;
  onPick: (sticker: Sticker) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="mb-3 flex gap-3 overflow-x-auto">
        {STICKER_PACKS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPack(item.id)}
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-lg ${
              pack === item.id ? "bg-violet-100 text-[#6D4AFF]" : "bg-slate-50 text-slate-600"
            }`}
            aria-label={item.label}
          >
            {item.kind === "recent" ? (
              <CategoryIcon id="clock" />
            ) : item.kind === "star" ? (
              "☆"
            ) : item.kind === "add" ? (
              "+"
            ) : (
              item.emoji
            )}
          </button>
        ))}
      </div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">Recent</h3>
      <div className="mb-4 grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="grid h-20 place-items-center rounded-2xl border border-dashed border-slate-300 text-center text-[11px] font-semibold text-slate-500"
        >
          Create sticker
        </button>
        {RECENT_STICKERS.map((sticker) => (
          <StickerButton key={sticker.id} sticker={sticker} onPick={onPick} />
        ))}
      </div>
      <h3 className="mb-2 text-sm font-semibold text-slate-700">★ Favorites</h3>
      <div className="grid grid-cols-5 gap-2">
        {FAVORITE_STICKERS.map((sticker) => (
          <StickerButton key={`fav-${sticker.id}`} sticker={sticker} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function AiTab({
  seed,
  onGenerate,
  onPick,
}: {
  seed: string;
  onGenerate?: (prompt: string, style: string) => Promise<AiSticker[]>;
  onPick: (sticker: AiSticker) => void;
}) {
  const [style, setStyle] = useState<(typeof AI_STYLES)[number]>("Cartoon");
  const [prompt, setPrompt] = useState(seed || "waving hello");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AiSticker[]>([]);

  async function generate(nextPrompt = prompt) {
    setPrompt(nextPrompt);
    setBusy(true);
    try {
      const made = onGenerate
        ? await onGenerate(nextPrompt, style)
        : AI_PROMPTS.slice(0, 4).map((item, index) => ({
            id: `${style}-${index}`,
            prompt: nextPrompt || item,
            style,
            emoji: ["👋", "☕", "🎉", "👍"][index],
          }));
      setResults(made);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div className="mb-3 flex gap-2 overflow-x-auto">
        {AI_STYLES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setStyle(item)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
              style === item ? "bg-[#6D4AFF] text-white" : "bg-violet-50 text-slate-600"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-2">
        <input
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe a sticker"
          className="h-10 flex-1 rounded-2xl bg-[#F4F1FB] px-3 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => generate()}
          disabled={busy || !prompt.trim()}
          className="rounded-2xl bg-[#6D4AFF] px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Making" : "Generate"}
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {AI_PROMPTS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => generate(item)}
            className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600"
          >
            {item}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {results.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            onClick={() => onPick(sticker)}
            className="grid h-16 place-items-center rounded-2xl bg-violet-50 text-3xl"
            aria-label={sticker.prompt}
          >
            {sticker.emoji}
          </button>
        ))}
      </div>
      {results.length === 0 && (
        <p className="text-sm text-slate-400">Generate a sticker, then tap it to send.</p>
      )}
    </div>
  );
}

function StickerButton({
  sticker,
  onPick,
}: {
  sticker: Sticker;
  onPick: (sticker: Sticker) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(sticker)}
      className="grid h-16 place-items-center rounded-2xl bg-slate-50 text-3xl hover:bg-violet-50"
      aria-label={sticker.label}
    >
      {sticker.emoji}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CategoryIcon({ id }: { id: string }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none" as const };
  if (id === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "flag") return <span className="text-base">⚑</span>;
  if (id === "bear") return <span className="text-base">🐻</span>;
  if (id === "food") return <span className="text-base">🍔</span>;
  if (id === "ball") return <span className="text-base">⚽</span>;
  if (id === "plane") return <span className="text-base">✈</span>;
  if (id === "bulb") return <span className="text-base">💡</span>;
  if (id === "symbols") return <span className="text-base">♥</span>;
  return <span className="text-base">☺</span>;
}
