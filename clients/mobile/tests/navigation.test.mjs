// Run: node --import ./tests/ts-resolve.mjs --test tests/navigation.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routes, NAV_GROUPS } from "../navigation/registry.ts";
import { breadcrumbsForPath, collapseCrumbs, navigationMode } from "../navigation/breadcrumbs.ts";
import { validateRoutes } from "../navigation/route-integrity.ts";
import { mayShowRoute, shellAllowedOnPath } from "../navigation/policy.ts";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

function pageRoutes() {
  const out = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts|jsx|js)$/.test(entry.name) && !/^[_+]/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
        const segments = path.relative(appDir, full).replace(/\.(tsx|ts|jsx|js)$/, "").split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
        if (segments.at(-1) === "index") segments.pop();
        out.add("/" + segments.join("/"));
      }
    }
  };
  walk(appDir);
  return out;
}

test("registry is structurally sound", () => assert.deepEqual(validateRoutes(routes), []));

test("every registry href and match prefix maps to a real page", () => {
  const pages = pageRoutes();
  for (const r of routes) {
    assert.ok(pages.has(r.href), `${r.id}: ${r.href} is not a page under app/`);
    for (const m of r.match ?? []) {
      assert.ok([...pages].some((p) => p === m || p.startsWith(m + "/")), `${r.id}: match ${m} has no page`);
    }
  }
});

test("sidebar entries have an icon and a known group", () => {
  for (const r of routes.filter((x) => x.group)) {
    assert.ok(r.icon, `${r.id} missing icon`);
    assert.ok(NAV_GROUPS.includes(r.group));
  }
});

for (const [width, mode] of [[599, "mobile"], [600, "tablet-compact"], [839, "tablet-compact"], [840, "tablet-expanded"], [1199, "tablet-expanded"], [1200, "desktop"]]) {
  test(`width ${width} is ${mode}`, () => assert.equal(navigationMode(width), mode));
}

const labels = (p) => breadcrumbsForPath(p).map((c) => c.label);

test("registered landing pages", () => {
  assert.deepEqual(labels("/home"), ["Home"]);
  assert.deepEqual(labels("/calls"), ["Home", "Calls"]);
  assert.deepEqual(labels("/countrylinqa/world"), ["Home", "CountryLinqa"]);
});

test("sub-screens extend the registered trail; ancestors are links, current is not", () => {
  const trail = breadcrumbsForPath("/vault/upload");
  assert.deepEqual(trail.map((c) => c.label), ["Home", "LinqaVault", "Upload"]);
  assert.deepEqual(trail.map((c) => c.route), ["/home", "/vault", undefined]);
  assert.deepEqual(labels("/linqasend/add-recipient"), ["Home", "LinqaSend", "Add recipient"]);
  assert.deepEqual(labels("/countrylinqa/plans-compare"), ["Home", "CountryLinqa", "Plans compare"]);
});

test("legacy module URL and nested registry parents", () => {
  assert.deepEqual(labels("/modules/file-vault"), ["Home", "LinqaVault"]);
  assert.deepEqual(labels("/message-requests"), ["Home", "Chats", "Message requests"]);
});

test("route groups, query strings and trailing slashes are ignored", () => {
  assert.deepEqual(labels("/(tabs)/chats?action=new"), ["Home", "Chats"]);
  assert.deepEqual(labels("/wallet/"), ["Home", "Wallet"]);
});

test("dynamic id segments never leak into labels", () => {
  assert.deepEqual(labels("/wallet/transaction/3f2b8c1e-5a7d-4e19-9c3a-0d1f2e3a4b5c"), ["Home", "Wallet", "Transaction", "Details"]);
});

test("unknown paths still give a way back Home", () => {
  const trail = breadcrumbsForPath("/mystery/area");
  assert.deepEqual(trail.map((c) => c.label), ["Home", "Mystery", "Area"]);
  assert.equal(trail[0].route, "/home");
  assert.equal(trail[1].route, undefined);
});

test("collapseCrumbs keeps first and last, exposes the rest as overflow", () => {
  const crumbs = ["A", "B", "C", "D", "E"].map((label) => ({ label }));
  const { visible, hidden } = collapseCrumbs(crumbs, 3);
  assert.deepEqual(visible.map((c) => c.label), ["A", "D", "E"]);
  assert.deepEqual(hidden.map((c) => c.label), ["B", "C"]);
  assert.deepEqual(collapseCrumbs(crumbs.slice(0, 3), 3).hidden, []);
});

test("policy fails closed", () => {
  const send = routes.find((r) => r.id === "send");
  const chats = routes.find((r) => r.id === "chats");
  assert.equal(mayShowRoute(chats, { signedIn: false, moneyAvailable: true }), false);
  assert.equal(mayShowRoute(send, { signedIn: true, moneyAvailable: null }), false);
  assert.equal(mayShowRoute(send, { signedIn: true, moneyAvailable: false }), false);
  assert.equal(mayShowRoute(send, { signedIn: true, moneyAvailable: true }), true);
  assert.equal(mayShowRoute(chats, { signedIn: true, moneyAvailable: null }), true);
});

test("shell stays off pre-auth, onboarding and modal flows", () => {
  for (const p of ["/welcome", "/onboarding/profile", "/account/sign-up", "/account/add-phone", "/linqasend/authorize"]) {
    assert.equal(shellAllowedOnPath(p), false, p);
  }
  for (const p of ["/home", "/chats", "/vault/upload", "/account/settings"]) assert.equal(shellAllowedOnPath(p), true, p);
});
