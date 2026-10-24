import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WALLPAPER_ID, DIM_STEPS, LIGHT_SYSTEM_WALLPAPER_ID, WALLPAPERS, WALLPAPER_CATEGORIES, contrastRatio, dimmed, getWallpaper, isWallpaperId, parseDim, resolveWallpaper, systemWallpaperId, wallpaperTheme
} from "../clients/mobile/services/wallpapers.ts";
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

test("a chat's own wallpaper wins over the person's default, which wins over matching the phone", () => {
  assert.equal(resolveWallpaper("theme_20", "theme_12", "light").wallpaper.id, "theme_20");
  assert.equal(resolveWallpaper("bogus", "theme_12", "dark").wallpaper.id, "theme_12"); // an unreadable per-chat value falls through
  const picked = resolveWallpaper(null, "theme_12", "light");
  assert.deepEqual([picked.wallpaper.id, picked.explicit], ["theme_12", true], "a chosen default ignores the phone's appearance");
});

test("with nothing chosen the wallpaper matches the phone: Classic Dark Doodle in dark, Light Mode Original in light", () => {
  for (const [scheme, id] of [["dark", "theme_01"], ["light", "theme_05"], [null, "theme_01"], [undefined, "theme_01"], ["unspecified", "theme_01"]] as const) {
    const r = resolveWallpaper(null, null, scheme);
    assert.deepEqual([r.wallpaper.id, r.explicit], [id, false], String(scheme));
  }
  assert.equal(resolveWallpaper(null, null).wallpaper.name, "Classic Dark Doodle", "no appearance info falls back to the built-in default");
  assert.equal(systemWallpaperId("light"), LIGHT_SYSTEM_WALLPAPER_ID);
  assert.equal(getWallpaper(LIGHT_SYSTEM_WALLPAPER_ID).name, "Light Mode Original");
  assert.equal(getWallpaper(LIGHT_SYSTEM_WALLPAPER_ID).isDark, false);
});

test("flipping the phone's appearance flips the wallpaper only while nothing is chosen", () => {
  assert.notEqual(resolveWallpaper(null, null, "dark").wallpaper.id, resolveWallpaper(null, null, "light").wallpaper.id);
  assert.equal(resolveWallpaper(null, "theme_11", "dark").wallpaper.id, resolveWallpaper(null, "theme_11", "light").wallpaper.id);
  assert.equal(resolveWallpaper("theme_20", null, "dark").wallpaper.id, resolveWallpaper("theme_20", null, "light").wallpaper.id);
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
