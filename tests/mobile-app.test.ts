import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "../clients/mobile/node_modules/typescript/lib/typescript.js";
import { darkColors, lightColors } from "../clients/mobile/theme/palettes.ts";

const mobile = path.resolve(import.meta.dirname, "../clients/mobile");
const appDir = path.join(mobile, "app");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}
const routeFiles = walk(appDir).filter((file) => /\.tsx$/.test(file));

function parse(file: string) {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// --- API base URL -----------------------------------------------------------

async function loadApi(dev: boolean) {
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  return import(`../clients/mobile/config/api.ts?dev=${dev}-${Math.random()}`) as Promise<{ getApiBaseUrl(): string }>;
}

test("getApiBaseUrl defaults to the forwarded USB port in dev", async () => {
  delete process.env.EXPO_PUBLIC_API_URL;
  assert.equal((await loadApi(true)).getApiBaseUrl(), "http://127.0.0.1:8080");
});

test("getApiBaseUrl trims trailing slashes and honours EXPO_PUBLIC_API_URL", async () => {
  process.env.EXPO_PUBLIC_API_URL = " https://api.example.com// ";
  assert.equal((await loadApi(false)).getApiBaseUrl(), "https://api.example.com");
  delete process.env.EXPO_PUBLIC_API_URL;
});

test("release builds fail closed on missing or insecure API URLs", async () => {
  const api = await loadApi(false);
  delete process.env.EXPO_PUBLIC_API_URL;
  assert.throws(() => api.getApiBaseUrl(), /must be set/);
  process.env.EXPO_PUBLIC_API_URL = "http://insecure.example.com";
  assert.throws(() => api.getApiBaseUrl(), /HTTPS/);
  delete process.env.EXPO_PUBLIC_API_URL;
});

// --- LinqaSend availability (fail closed) ------------------------------------

test("LinqaSend availability is false on errors and non-OK responses, true only for available:true", async (t) => {
  const mod = await import("../clients/mobile/services/linqasend-availability.ts");
  const session = await import("../clients/mobile/services/session.ts");
  process.env.EXPO_PUBLIC_API_URL = "https://api.example.com";
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  t.mock.method(session.accessTokenProvider, "getAccessToken", async () => "token");

  const cases: Array<[() => Promise<Response>, boolean]> = [
    [async () => new Response(JSON.stringify({ available: true }), { status: 200 }), true],
    [async () => new Response(JSON.stringify({ available: false }), { status: 200 }), false],
    [async () => new Response(JSON.stringify({ available: "true" }), { status: 200 }), false],
    [async () => new Response("{}", { status: 500 }), false],
    [async () => { throw new Error("offline"); }, false]
  ];
  for (const [respond, expected] of cases) {
    mod.resetLinqaSendAvailabilityCache();
    t.mock.method(globalThis, "fetch", respond);
    assert.equal(await mod.loadLinqaSendAvailability(), expected);
    t.mock.restoreAll();
    t.mock.method(session.accessTokenProvider, "getAccessToken", async () => "token");
  }
  delete process.env.EXPO_PUBLIC_API_URL;
});

test("isMoneyRoute only matches LinqaSend routes", async () => {
  const { isMoneyRoute } = await import("../clients/mobile/services/linqasend-availability.ts");
  assert.equal(isMoneyRoute("/linqasend"), true);
  assert.equal(isMoneyRoute("/linqasend/send"), true);
  assert.equal(isMoneyRoute("/settings/storage"), false);
});

// --- Route structure ---------------------------------------------------------

test("every route file has a default export", () => {
  const missing = routeFiles.filter((file) => {
    const sf = parse(file);
    return !sf.statements.some((st) =>
      (ts.isFunctionDeclaration(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) ||
      ts.isExportAssignment(st)
    );
  });
  assert.deepEqual(missing.map((f) => path.relative(appDir, f)), []);
});

test("every Stack.Screen in the root layout points at an existing route", () => {
  const layout = fs.readFileSync(path.join(appDir, "_layout.tsx"), "utf8");
  const names = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(names.length > 10, "expected the root layout to register screens");
  const missing = names.filter((name) => {
    const base = path.join(appDir, name);
    return !(fs.existsSync(`${base}.tsx`) || fs.existsSync(path.join(base, "index.tsx")) || fs.existsSync(base));
  });
  assert.deepEqual(missing, []);
});

test("relative imports in route files resolve to real files", () => {
  const unresolved: string[] = [];
  for (const file of routeFiles) {
    for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = path.resolve(path.dirname(file), match[1]!);
      const ok = [".ts", ".tsx", ".js", ".json", "/index.ts", "/index.tsx"].some((ext) => fs.existsSync(target + ext)) || fs.existsSync(target);
      if (!ok) unresolved.push(`${path.relative(mobile, file)} -> ${match[1]}`);
    }
  }
  assert.deepEqual(unresolved, []);
});

test("no screen hard-codes an API URL; all go through getApiBaseUrl", () => {
  const offenders = routeFiles.filter((file) => /EXPO_PUBLIC_API_URL|127\.0\.0\.1:80/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(mobile, f)), []);
});

// --- Theme -------------------------------------------------------------------

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test("light and dark palettes keep body text at WCAG AA (4.5:1) on bg and surface", () => {
  for (const [name, palette] of [["light", lightColors], ["dark", darkColors]] as const) {
    for (const surface of [palette.bg, palette.surface]) {
      for (const key of ["text", "textMuted", "textFaint", "accent", "danger"] as const) {
        assert.ok(contrast(palette[key], surface) >= 4.5, `${name}.${key} on ${surface} is ${contrast(palette[key], surface).toFixed(2)}`);
      }
    }
    assert.ok(contrast(palette.onAccent, palette.accent) >= 4.5, `${name}.onAccent on accent`);
    assert.ok(contrast(palette.danger, palette.dangerBg) >= 4.5, `${name}.danger on dangerBg`);
    assert.ok(contrast(palette.warning, palette.warningBg) >= 4.5, `${name}.warning on warningBg`);
  }
});

test("light and dark palettes define the same keys", () => {
  assert.deepEqual(Object.keys(lightColors).sort(), Object.keys(darkColors).sort());
});

// --- Account switching ---------------------------------------------------------

test("switching accounts never routes by the account's display label", async () => {
  const { ACCOUNT_SWITCH_LANDING_ROUTE } = await import("../clients/mobile/account/landing.ts");
  assert.equal(ACCOUNT_SWITCH_LANDING_ROUTE, "/onboarding/resolve");
  const offenders = routeFiles.filter((file) => /\.(label|displayName)\b[^;\n]*\.includes\(\s*["'](business|research)["']/i.test(fs.readFileSync(file, "utf8"))
    || /label\.includes\(\s*["'](business|research)["']/i.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(mobile, f)), []);
  for (const name of ["app/(tabs)/chats.tsx", "app/(tabs)/_layout.tsx", "app/account/manage.tsx", "app/account/switcher.tsx"]) {
    assert.match(fs.readFileSync(path.join(mobile, name), "utf8"), /ACCOUNT_SWITCH_LANDING_ROUTE/, `${name} should use the shared landing route`);
  }
});

// --- Native-module safety ------------------------------------------------------

test("screens use the native-free LinearGradient, not expo-linear-gradient directly", () => {
  // The installed development build has no native ExpoLinearGradient view, so importing it in a
  // screen produces a red "Can't find ViewManager" error. Use components/LinearGradient instead.
  const offenders = [...routeFiles, ...walk(path.join(mobile, "components"))]
    .filter((file) => !file.endsWith(`${path.sep}LinearGradient.tsx`))
    .filter((file) => /\.tsx?$/.test(file) && /from\s+["']expo-linear-gradient["']/.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(mobile, f)), []);
});

test("blendColors averages hex colors and falls back safely", async () => {
  const { blendColors } = await import("../clients/mobile/components/blendColors.ts");
  assert.equal(blendColors(["#000000", "#FFFFFF"]), "#808080");
  assert.equal(blendColors(["#102030"]), "#102030");
  assert.equal(blendColors(["rgba(0,0,0,0.5)", "#FFFFFF"]), "rgba(0,0,0,0.5)");
  assert.equal(blendColors([]), "transparent");
});

test("LinqaSend screens and components do not draw with react-native-svg (the installed build cannot render it)", () => {
  const files = [...routeFiles.filter((f) => f.includes(`${path.sep}linqasend${path.sep}`)), ...walk(path.join(mobile, "components", "linqasend"))];
  const offenders = files.filter((f) => /\.tsx?$/.test(f) && /from\s+["']react-native-svg["']/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders.map((f) => path.relative(mobile, f)), []);
});
