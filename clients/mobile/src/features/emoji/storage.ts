import { EMPTY_PREFS, type ExpressionPrefs, type SkinTone } from "./catalog";

const KEY = "linqa.expression.v1";

/** Preferences are not secret and the package is already in the app, so a small JSON file in the app's document folder holds them. */
type StorageLike = { read(): Promise<string | null>; write(value: string): Promise<void> };

async function storage(): Promise<StorageLike | null> {
  try {
    const { File, Paths } = await import("expo-file-system");
    const file = new File(Paths.document, `${KEY}.json`);
    return {
      async read() { return file.exists ? await file.text() : null; },
      async write(value) { if (!file.exists) file.create(); file.write(value); }
    };
  } catch {
    return null;
  }
}

export async function loadPrefs(): Promise<ExpressionPrefs> {
  const store = await storage();
  if (!store) return EMPTY_PREFS;
  try {
    const raw = await store.read();
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
    await store.write(JSON.stringify(prefs));
  } catch {
    // A full disk or a read-only folder. The sheet still works for this session.
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
