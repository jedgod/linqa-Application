import test from "node:test";
import assert from "node:assert/strict";
import { failureText, isFinalImportState, planPrice, planSize, formatBytes, groupByType, isPrivateType, itemTitle, newestFirst, relativeDay, totalBytes } from "../clients/mobile/services/vault-view.ts";

const item = (id: string, item_type: any, encrypted_size: number, created_at: string) => ({ id, item_type, encrypted_size, version: 1, created_at });
const items = [
  item("aaaaaaaa-1", "DOCUMENT", 2_500_000, "2026-10-04T10:00:00Z"),
  item("bbbbbbbb-2", "DOCUMENT", 1_200_000, "2026-10-01T10:00:00Z"),
  item("cccccccc-3", "PHOTO", 800, "2026-10-03T10:00:00Z"),
  item("dddddddd-4", "IDENTITY", 5000, "2026-10-05T10:00:00Z")
];

test("formatBytes picks a readable unit", () => {
  assert.equal(formatBytes(0), "0 KB");
  assert.equal(formatBytes(800), "1 KB");
  assert.equal(formatBytes(2_500_000), "2.4 MB");
  assert.equal(formatBytes(3_221_225_472), "3.0 GB");
});

test("relativeDay speaks in days then dates", () => {
  const now = new Date(2026, 9, 5, 12);
  assert.equal(relativeDay(new Date(2026, 9, 5, 1).toISOString(), now), "Today");
  assert.equal(relativeDay(new Date(2026, 9, 4, 23).toISOString(), now), "Yesterday");
  assert.equal(relativeDay(new Date(2026, 9, 2, 9).toISOString(), now), "3 days ago");
  assert.equal(relativeDay("not a date", now), "");
});

test("groups are per type, counted, newest first", () => {
  const groups = groupByType(items);
  assert.deepEqual(groups.map((g) => [g.type, g.count]), [["IDENTITY", 1], ["DOCUMENT", 2], ["PHOTO", 1]]);
  assert.equal(groups[1]!.latest, "2026-10-04T10:00:00Z");
});

test("identity and recovery items are private", () => {
  assert.equal(isPrivateType("IDENTITY"), true);
  assert.equal(isPrivateType("RECOVERY"), true);
  assert.equal(isPrivateType("DOCUMENT"), false);
});

test("totals, ordering and titles never use decrypted names", () => {
  assert.equal(totalBytes(items), 2_500_000 + 1_200_000 + 800 + 5000);
  assert.equal(newestFirst(items)[0]!.id, "dddddddd-4");
  assert.equal(itemTitle(items[0]!), "Document · AAAAAA");
});

test("plans read as sizes and monthly prices", () => {
  assert.equal(planSize(5_368_709_120), "5 GB");
  assert.equal(planSize(64_424_509_440), "60 GB");
  assert.equal(planSize(1_099_511_627_776), "1 TB");
  assert.equal(planPrice(0, "USD"), "$0.00");
  assert.equal(planPrice(199, "USD"), "$1.99/mo");
});

test("import outcomes have plain-language reasons and a clear end state", () => {
  assert.match(failureText("SCAN_BLOCKED"), /security scan/i);
  assert.match(failureText("SOCIAL_SOURCE_NOT_CONFIGURED"), /not connected/i);
  assert.equal(failureText("SOMETHING_NEW"), "This file could not be saved.");
  assert.equal(failureText(null), "This file could not be saved.");
  for (const state of ["AWAITING_CONFIRMATION", "VAULTED", "BLOCKED", "FAILED"]) assert.equal(isFinalImportState(state), true);
  for (const state of ["RECEIVED", "FETCHING", "QUARANTINED", "SCANNING"]) assert.equal(isFinalImportState(state), false);
});
