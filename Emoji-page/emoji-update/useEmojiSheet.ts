import { useEffect, useMemo, useState } from "react";
import {
  applyTone,
  searchCategories,
  STICKERS,
  type ExpressionPrefs,
  type SkinTone,
  type Sticker,
} from "./catalog";
import { loadPrefs, remember, savePrefs, toggleFavorite } from "./storage";

type Options = {
  onInsert: (emoji: string) => void;
  onSendSticker?: (sticker: Sticker) => void;
};

export function useEmojiSheet({ onInsert, onSendSticker }: Options) {
  const [prefs, setPrefs] = useState<ExpressionPrefs | null>(null);
  const [tab, setTab] = useState<"emoji" | "stickers">("emoji");
  const [query, setQuery] = useState("");
  const [toneTarget, setToneTarget] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    loadPrefs().then((loaded) => {
      if (!live) return;
      setPrefs(loaded);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (prefs && ready) void savePrefs(prefs);
  }, [prefs, ready]);

  const categories = useMemo(() => searchCategories(query), [query]);
  const stickers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STICKERS.filter((sticker) => !q || sticker.label.toLowerCase().includes(q) || sticker.emoji.includes(q));
  }, [query]);

  function commit(next: ExpressionPrefs) {
    setPrefs(next);
  }

  return {
    prefs,
    tab,
    setTab: (next: "emoji" | "stickers") => {
      setTab(next);
      setQuery("");
      setToneTarget(null);
    },
    query,
    setQuery,
    toneTarget,
    setToneTarget,
    categories,
    stickers,
    setDefaultTone(tone: SkinTone) {
      if (!prefs) return;
      commit({ ...prefs, defaultTone: tone });
    },
    insert(base: string, tonable?: boolean) {
      if (!prefs) return;
      const tone = tonable ? prefs.tones[base] ?? prefs.defaultTone : 0;
      const emoji = tonable ? applyTone(base, tone) : base;
      commit(remember(prefs, emoji, tonable ? tone : undefined));
      onInsert(emoji);
      setToneTarget(null);
    },
    chooseTone(base: string, tone: SkinTone) {
      if (!prefs) return;
      const emoji = applyTone(base, tone);
      commit({ ...remember(prefs, emoji, tone), defaultTone: tone, tones: { ...prefs.tones, [base]: tone } });
      onInsert(emoji);
      setToneTarget(null);
    },
    sendSticker(sticker: Sticker) {
      if (!prefs) return;
      commit(remember(prefs, sticker.emoji));
      if (onSendSticker) onSendSticker(sticker);
      else onInsert(sticker.emoji);
    },
    favorite(sticker: Sticker) {
      if (!prefs) return;
      commit(toggleFavorite(prefs, sticker.id));
    },
  };
}
