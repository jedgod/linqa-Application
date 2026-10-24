import test from "node:test";
import assert from "node:assert/strict";
import React from "../clients/mobile/node_modules/react/index.js";
import TestRenderer from "../clients/mobile/node_modules/react-test-renderer/index.js";
import { WallpaperProvider } from "../clients/mobile/components/conversation/WallpaperContext.tsx";
import { useWallpaper, type WallpaperState } from "../clients/mobile/components/conversation/useWallpaper.ts";

// The hook and its provider are exercised for real (React renders, state updates, the shared revision signal) against the
// stubbed SecureStore from tests/support/react-native-stub.cjs. Each test uses its own account id so stored choices never overlap.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act } = TestRenderer;
const h = React.createElement;

type Probe = { latest: WallpaperState | null; renders: string[] };
function probe(userId: string, conversationId: string | undefined): { probe: Probe; element: React.ReactElement; fresh: () => React.ReactElement } {
  const p: Probe = { latest: null, renders: [] };
  function Consumer(_props: { tick?: number }) {
    const state = useWallpaper(userId, conversationId);
    p.latest = state;
    p.renders.push(state.wallpaper.id);
    return null;
  }
  // The real useColorScheme re-renders its subscribers when the phone changes; the stub is a plain function, so the tests
  // hand React a new element (new props) to stand in for that re-render.
  let tick = 0;
  return { probe: p, element: h(Consumer), fresh: () => h(Consumer, { tick: ++tick }) };
}

function mount(children: React.ReactElement[], withProvider = true) {
  const tree = withProvider ? h(WallpaperProvider, null, ...children) : h(React.Fragment, null, ...children);
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(tree); });
  return renderer;
}

test("nothing chosen: the wallpaper matches the phone and follows it live", () => {
  globalThis.__colorScheme = "dark";
  const { probe: p, element, fresh } = probe("ctx-user-1", "chat-a");
  const renderer = mount([element]);
  assert.deepEqual([p.latest!.wallpaper.id, p.latest!.explicit, p.latest!.dim], ["theme_01", false, 0]);

  globalThis.__colorScheme = "light";
  act(() => { renderer.update(h(WallpaperProvider, null, fresh())); });
  assert.equal(p.latest!.wallpaper.id, "theme_05", "light phone → Light Mode Original");
  globalThis.__colorScheme = "dark";
  act(() => { renderer.update(h(WallpaperProvider, null, fresh())); });
  assert.equal(p.latest!.wallpaper.id, "theme_01");
});

test("a default chosen in settings reaches a chat that is already open", () => {
  globalThis.__colorScheme = "dark";
  const chat = probe("ctx-user-2", "chat-a");
  const settings = probe("ctx-user-2", undefined);
  mount([chat.element, settings.element]);
  assert.equal(chat.probe.latest!.wallpaper.id, "theme_01");

  act(() => { assert.equal(settings.probe.latest!.setDefault("theme_16"), true); });
  assert.equal(chat.probe.latest!.wallpaper.id, "theme_16", "the open chat updated without remounting");
  assert.equal(settings.probe.latest!.wallpaper.id, "theme_16");
  assert.equal(chat.probe.latest!.explicit, true);
  assert.equal(chat.probe.latest!.defaultId, "theme_16");
});

test("dimming chosen anywhere reaches every consumer", () => {
  const a = probe("ctx-user-3", "chat-a");
  const b = probe("ctx-user-3", "chat-b");
  mount([a.element, b.element]);
  act(() => { assert.equal(a.probe.latest!.setDim(0.45), true); });
  assert.equal(a.probe.latest!.dim, 0.45);
  assert.equal(b.probe.latest!.dim, 0.45);
  act(() => { b.probe.latest!.setDim(0.31); }); // snaps to an offered step
  assert.equal(a.probe.latest!.dim, 0.3);
});

test("a chat's own wallpaper wins in that chat only, and 'follow default' removes it", () => {
  const a = probe("ctx-user-4", "chat-a");
  const b = probe("ctx-user-4", "chat-b");
  mount([a.element, b.element]);
  act(() => { a.probe.latest!.setDefault("theme_11"); });
  act(() => { a.probe.latest!.setForChat("theme_20"); });
  assert.equal(a.probe.latest!.wallpaper.id, "theme_20");
  assert.equal(a.probe.latest!.chatId, "theme_20");
  assert.equal(b.probe.latest!.wallpaper.id, "theme_11", "the other chat keeps following the default");
  assert.equal(b.probe.latest!.chatId, null);

  act(() => { a.probe.latest!.setForChat(null); });
  assert.equal(a.probe.latest!.wallpaper.id, "theme_11");
});

test("turning 'match system' back on clears the default so the phone decides again", () => {
  globalThis.__colorScheme = "light";
  const a = probe("ctx-user-5", "chat-a");
  mount([a.element]);
  act(() => { a.probe.latest!.setDefault("theme_12"); });
  assert.equal(a.probe.latest!.wallpaper.id, "theme_12");
  act(() => { a.probe.latest!.setDefault(null); });
  assert.deepEqual([a.probe.latest!.wallpaper.id, a.probe.latest!.explicit], ["theme_05", false]);
  globalThis.__colorScheme = "dark";
});

test("a saved choice is on screen from the very first render of a cold start (no pop-in)", () => {
  globalThis.__colorScheme = "dark";
  const first = probe("ctx-user-6", "chat-a");
  const r1 = mount([first.element]);
  act(() => { first.probe.latest!.setDefault("theme_28"); first.probe.latest!.setDim(0.15); });
  act(() => { r1.unmount(); });

  const second = probe("ctx-user-6", "chat-a");
  mount([second.element]);
  assert.equal(second.probe.renders[0], "theme_28", "the first frame already shows the saved wallpaper, not the default");
  assert.deepEqual([...new Set(second.probe.renders)], ["theme_28"], "it never rendered any other wallpaper");
  assert.equal(second.probe.latest!.dim, 0.15);
});

test("accounts on one phone keep separate wallpapers", () => {
  const one = probe("ctx-user-7", "chat-a");
  const two = probe("ctx-user-8", "chat-a");
  mount([one.element, two.element]);
  act(() => { one.probe.latest!.setDefault("theme_30"); });
  assert.equal(one.probe.latest!.wallpaper.id, "theme_30");
  assert.notEqual(two.probe.latest!.wallpaper.id, "theme_30");
  assert.equal(two.probe.latest!.defaultId, null);
});

test("without a provider (isolated previews) the hook still works on its own", () => {
  const a = probe("ctx-user-9", "chat-a");
  mount([a.element], false);
  act(() => { assert.equal(a.probe.latest!.setDefault("theme_22"), true); });
  assert.equal(a.probe.latest!.wallpaper.id, "theme_22");
});

test("no account yet: nothing is read or written, and saving reports failure", () => {
  const none = probe("", "chat-a");
  mount([none.element]);
  assert.equal(none.probe.latest!.defaultId, null);
  act(() => { assert.equal(none.probe.latest!.setDefault("theme_22"), false); });
  assert.equal(none.probe.latest!.defaultId, null);
});
