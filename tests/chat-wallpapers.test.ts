import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WALLPAPER_ID, DIM_STEPS, WALLPAPERS, WALLPAPER_CATEGORIES, contrastRatio, dimmed, getWallpaper, isWallpaperId, parseDim, resolveWallpaper, wallpaperTheme
} from "../clients/mobile/services/wallpapers.ts";
import { THEMES, DEFAULT_PREFS } from "../clients/mobile/services/conversation-engine.ts";
import { createWallpaperStore, type KeyValueStore } from "../clients/mobile/services/wallpaper-store.ts";

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => (data.set(k, v), true), remove: (k) => (data.delete(k), true) };
};

test("catalog has 30 unique wallpapers across the four categories, each with a valid colour set", () => {
  assert.equal(WALLPAPERS.length, 30);
  assert.equal(new Set(WALLPAPERS.map((w) => w.id)).size, 30);
  assert.equal(new Set(WALLPAPERS.map((w) => w.name)).size, 30);
  for (const category of WALLPAPER_CATEGORIES) assert.ok(WALLPAPERS.some((w) => w.category === category), category);
  for (const w of WALLPAPERS) {
    assert.ok(WALLPAPER_CATEGORIES.includes(w.category), w.id);
    assert.ok(w.bgColors.length >= 1 && w.bgColors.every((c) => /^#[0-9A-F]{6}$/i.test(c)), `${w.id} colours`);
    assert.match(w.accentColor, /^#[0-9A-F]{6}$/i);
  }
});

test("Classic Dark Doodle is the built-in default and the fallback for anything unknown", () => {
  assert.equal(getWallpaper(DEFAULT_WALLPAPER_ID).name, "Classic Dark Doodle");
  assert.equal(WALLPAPERS[0]!.id, DEFAULT_WALLPAPER_ID);
  for (const bad of [null, undefined, "", "theme_99", "__proto__"]) assert.equal(getWallpaper(bad).id, DEFAULT_WALLPAPER_ID);
  assert.equal(isWallpaperId("theme_30"), true);
  assert.equal(isWallpaperId(30), false);
});

test("a chat's own wallpaper wins over the person's default, which wins over the built-in default", () => {
  assert.equal(resolveWallpaper("theme_20", "theme_12").wallpaper.id, "theme_20");
  assert.equal(resolveWallpaper("bogus", "theme_12").wallpaper.id, "theme_12"); // an unreadable per-chat value falls through
  const picked = resolveWallpaper(null, "theme_12");
  assert.deepEqual([picked.wallpaper.id, picked.explicit], ["theme_12", true]);
  const builtIn = resolveWallpaper(null, null);
  assert.deepEqual([builtIn.wallpaper.id, builtIn.explicit], [DEFAULT_WALLPAPER_ID, false]);
});

test("the phone's light/dark setting never changes which wallpaper a conversation gets", () => {
  // resolveWallpaper takes no appearance input at all: a conversation cannot flip to light because the phone did.
  assert.equal(resolveWallpaper.length, 2);
  assert.equal(resolveWallpaper(null, null).wallpaper.name, "Classic Dark Doodle");
  assert.equal(getWallpaper(DEFAULT_WALLPAPER_ID).isDark, true);
});

test("message text stays readable on every wallpaper's own bubbles (WCAG AA, 4.5:1)", () => {
  for (const w of WALLPAPERS) {
    const t = wallpaperTheme(w);
    assert.equal(t.outgoing, w.accentColor);
    assert.equal(t.background, w.bgColors[0]);
    const ratio = contrastRatio(t.outgoing, t.onOutgoing);
    assert.ok(ratio >= 4.5, `${w.name}: ${ratio.toFixed(2)}`);
  }
});

test("dark wallpapers use the dark chat palette and light ones the light palette, so incoming text reads on the backdrop", () => {
  for (const w of WALLPAPERS) {
    const t = wallpaperTheme(w);
    assert.ok(contrastRatio(t.ink, t.background) >= 4.5, `${w.name}: ink on backdrop ${contrastRatio(t.ink, t.background).toFixed(2)}`);
  }
});

test("store keeps the default per account and an override per chat, and ignores junk", () => {
  const kv = memory();
  const store = createWallpaperStore(kv);
  assert.equal(store.loadDefault("u1"), null);
  assert.equal(store.saveDefault("u1", "theme_11"), true);
  assert.equal(store.loadDefault("u1"), "theme_11");
  assert.equal(store.loadDefault("u2"), null, "another account on the phone is unaffected");

  assert.equal(store.saveChat("u1", "c1", "theme_20"), true);
  assert.equal(store.loadChat("u1", "c1"), "theme_20");
  assert.equal(store.loadChat("u1", "c2"), null);
  assert.equal(store.loadChat("u2", "c1"), null);

  assert.equal(store.saveChat("u1", "c1", null), true, "reset removes the override");
  assert.equal(store.loadChat("u1", "c1"), null);

  assert.equal(store.saveDefault("u1", "not-a-wallpaper"), false);
  assert.equal(store.loadDefault("u1"), "theme_11", "a rejected save changes nothing");
  kv.data.set("linqa.wallpaper.default.u1", "tampered");
  assert.equal(store.loadDefault("u1"), null, "an unknown stored id reads as unset");
  kv.data.set("linqa.wallpaper.default.u1", "");
  assert.equal(store.loadDefault("u1"), null, "an empty value (how SecureStore stores 'unset') reads as unset");
});

test("reads are synchronous, so a saved wallpaper is known on the very first render", () => {
  const store = createWallpaperStore(memory());
  store.saveDefault("u1", "theme_28");
  const read = store.loadDefault("u1");
  assert.equal(read, "theme_28");
  assert.notEqual(read instanceof Promise, true);
});

test("storage keys are sanitized for SecureStore and storage failures never throw", () => {
  const seen: string[] = [];
  const store = createWallpaperStore({ get: (k) => (seen.push(k), null), set: (k) => (seen.push(k), true), remove: () => true });
  store.saveChat("user/../1", "chat id!", "theme_01");
  store.saveDim("a b", 0.3);
  assert.ok(seen.length === 2 && seen.every((k) => /^[A-Za-z0-9._-]+$/.test(k)), seen.join());
  const boom = () => { throw new Error("x"); };
  const broken = createWallpaperStore({ get: boom, set: boom, remove: boom });
  assert.equal(broken.loadDefault("u"), null);
  assert.equal(broken.saveDefault("u", "theme_01"), false);
  assert.equal(broken.loadDim("u"), 0);
  assert.equal(broken.saveDim("u", 0.3), false);
});

test("dim levels snap to the offered steps, and junk reads as off", () => {
  assert.deepEqual([...DIM_STEPS], [0, 0.15, 0.3, 0.45, 0.6]);
  for (const step of DIM_STEPS) assert.equal(parseDim(step), step);
  assert.equal(parseDim("0.3"), 0.3);
  assert.equal(parseDim(0.31), 0.3);
  assert.equal(parseDim(0.9), 0.6, "never darker than the maximum");
  assert.equal(parseDim(-1), 0);
  for (const junk of [null, undefined, "", "abc", NaN, Infinity, {}, []]) assert.equal(parseDim(junk), 0, String(junk));
});

test("dim is saved per account", () => {
  const store = createWallpaperStore(memory());
  assert.equal(store.loadDim("u1"), 0);
  assert.equal(store.saveDim("u1", 0.45), true);
  assert.equal(store.loadDim("u1"), 0.45);
  assert.equal(store.loadDim("u2"), 0);
  assert.equal(store.saveDim("u1", 5), true);
  assert.equal(store.loadDim("u1"), 0.6, "an out-of-range save is clamped, not stored raw");
});

test("dimming darkens the backdrop as the mask draws it", () => {
  assert.equal(dimmed("#FFFFFF", 0), "#FFFFFF", "no dimming leaves the colour exactly as it was");
  assert.equal(dimmed("#FFFFFF", 0.6), "#666666");
  assert.equal(dimmed("#000000", 0.6), "#000000");
});

test("text drawn straight onto the backdrop stays readable at every wallpaper and every dim level", () => {
  const failures: string[] = [];
  for (const w of WALLPAPERS) for (const dim of DIM_STEPS) {
    const t = wallpaperTheme(w, dim);
    const ratio = contrastRatio(t.ink, t.background);
    if (ratio < 4.5) failures.push(`${w.name} @${dim}: ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(failures, []);
});

// ---- The approved dark design (Chats list and conversation thread) ----
test("the approved dark palette is exactly what was specified", () => {
  const d = THEMES.dark;
  assert.deepEqual(
    [d.background, d.surface, d.incoming, d.outgoing, d.ink, d.muted, d.line],
    ["#121214", "#22252B", "#22252B", "#087F79", "#FFFFFF", "#B9C1CA", "#34383F"]
  );
});

test("conversations default to dark, and Classic Dark Doodle is the approved background and outgoing colour", () => {
  assert.equal(DEFAULT_PREFS.theme, "dark");
  const w = getWallpaper(DEFAULT_WALLPAPER_ID);
  assert.deepEqual([w.bgColors[0], w.accentColor], ["#121214", "#087F79"]);
  const t = wallpaperTheme(w);
  assert.deepEqual([t.background, t.outgoing, t.incoming, t.ink, t.muted, t.line], ["#121214", "#087F79", "#22252B", "#FFFFFF", "#B9C1CA", "#34383F"]);
});

test("every text pairing in the approved dark palette meets WCAG AA (4.5:1)", () => {
  const d = THEMES.dark;
  const pairs: Array<[string, string, string]> = [
    ["primary text on background", d.ink, d.background],
    ["primary text on cards", d.ink, d.surface],
    ["primary text on incoming bubbles", d.ink, d.incoming],
    ["secondary text on background", d.muted, d.background],
    ["secondary text on cards (timestamps)", d.muted, d.surface],
    ["text on outgoing bubbles", d.onOutgoing, d.outgoing],
    ["accent on background", d.accent, d.background],
    ["accent on cards", d.accent, d.surface],
    ["text on accent", d.onAccent, d.accent],
    ["secure/protected indicator on cards", d.secure, d.surface],
    ["sealed indicator on background", d.sealed, d.background],
    ["warning on its surface", d.warn, d.warnSurface],
    ["danger on cards", d.danger, d.surface],
    ["primary text on highlight", d.ink, d.highlight]
  ];
  const failures = pairs.filter(([, fg, bg]) => contrastRatio(fg, bg) < 4.5).map(([name, fg, bg]) => `${name}: ${contrastRatio(fg, bg).toFixed(2)}`);
  assert.deepEqual(failures, []);
});

test("the in-thread card palette keeps its on-colour text readable in the dark thread (secure and danger fills)", async () => {
  const { paletteFromTheme } = await import("../clients/mobile/features/conversation/ui/ThreadPalette.tsx");
  const p = paletteFromTheme(THEMES.dark);
  const pairs: Array<[string, string, string]> = [
    ["text on secure fill", p.onSecure, p.secure],
    ["text on danger fill", p.onDanger, p.danger],
    ["text on outgoing", p.outgoingInk, p.outgoing],
    ["ink on card", p.ink, p.surface],
    ["muted on card", p.muted, p.surface],
    ["ink on secure tint (own poll vote bar)", p.ink, p.secureTint]
  ];
  const failures = pairs.filter(([, fg, bg]) => contrastRatio(fg, bg) < 4.5).map(([name, fg, bg]) => `${name}: ${contrastRatio(fg, bg).toFixed(2)}`);
  assert.deepEqual(failures, []);
});
