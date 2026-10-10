import { EMPTY_PREFS, type ExpressionPrefs, type SkinTone } from "./catalog";

const KEY = "linqa.expression.v1";

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

async function storage(): Promise<StorageLike | null> {
  try {
    const mod = await import("@react-native-async-storage/async-storage");
    return mod.default;
  } catch {
    return null;
  }
}

export async function loadPrefs(): Promise<ExpressionPrefs> {
  const store = await storage();
  if (!store) return EMPTY_PREFS;
  try {
    const raw = await store.getItem(KEY);
    if (!raw) return EMPTY_PREFS;
    const parsed = JSON.parse(raw) as ExpressionPrefs;
    return parsed.version === 1 ? { ...EMPTY_PREFS, ...parsed } : EMPTY_PREFS;
  } catch {
    return EMPTY_PREFS;
  }
}

export async function savePrefs(prefs: ExpressionPrefs) {
  const store = await storage();
  if (!store) return;
  try {
    await store.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or full disk. The sheet still works for this session.
  }
}

export function remember(prefs: ExpressionPrefs, emoji: string, tone?: SkinTone): ExpressionPrefs {
  return {
    ...prefs,
    recent: [emoji, ...prefs.recent.filter((item) => item !== emoji)].slice(0, 36),
    tones: tone === undefined ? prefs.tones : { ...prefs.tones, [emoji]: tone },
  };
}

export function toggleFavorite(prefs: ExpressionPrefs, id: string): ExpressionPrefs {
  const on = prefs.favoriteIds.includes(id);
  return {
    ...prefs,
    favoriteIds: on ? prefs.favoriteIds.filter((item) => item !== id) : [id, ...prefs.favoriteIds].slice(0, 48),
  };
}
