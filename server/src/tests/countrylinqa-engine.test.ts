import { describe, expect, it } from "vitest";
import { canExposePerson, type CandidatePolicy, type ViewerPolicy } from "../services/countrylinqa/engine/eligibility.js";
import { canonicalFilters, validateFilters } from "../services/countrylinqa/engine/filters.js";
import { cursorKey, decodeCursor, encodeCursor } from "../services/countrylinqa/engine/cursor.js";
import { diversify, rankAll, rankCandidate, type RankCandidate } from "../services/countrylinqa/engine/ranker.js";
import { savedFiltersToDiscovery } from "../services/countrylinqa/engine/jobs.js";

const regionCountries = { NA: ["US", "CA", "MX"], "AF-W": ["GH", "NG"] };
const viewer: ViewerPolicy = { verifiedCountryCode: "US", verified: true, outboundMode: "SELECTED_COUNTRIES", selectedCountries: ["US", "GH"], selectedRegions: [], verifiedOnly: true, paused: false };
const candidate = (o: Partial<CandidatePolicy> = {}): CandidatePolicy => ({
  verifiedCountryCode: "GH", verified: true, inboundMode: "GLOBAL", inboundCountries: [], inboundRegions: [],
  paused: false, discoverable: true, restricted: false, ...o
});
const expose = (c: CandidatePolicy, rel = { isExistingContact: false, isBlocked: false }, v = viewer) =>
  canExposePerson({ viewer: v, candidate: c, relationship: rel, regionCountries });

describe("mutual discovery eligibility (reference model)", () => {
  it("allows a mutually eligible candidate", () => expect(expose(candidate())).toBe(true));
  it("a block overrides every geographic mode", () => {
    expect(expose(candidate(), { isExistingContact: true, isBlocked: true })).toBe(false);
    expect(expose(candidate(), { isExistingContact: false, isBlocked: true }, { ...viewer, outboundMode: "GLOBAL" })).toBe(false);
  });
  it("Worldwide still respects the candidate's inbound privacy", () => {
    expect(expose(candidate({ inboundMode: "MY_COUNTRY" }), undefined, { ...viewer, outboundMode: "GLOBAL" })).toBe(false);
  });
  it("Contacts Only hides from strangers and shows to contacts", () => {
    expect(expose(candidate({ inboundMode: "CONTACTS_ONLY" }))).toBe(false);
    expect(expose(candidate({ inboundMode: "CONTACTS_ONLY" }), { isExistingContact: true, isBlocked: false })).toBe(true);
  });
  it("pause, undiscoverable, restricted and verified-only all exclude", () => {
    expect(expose(candidate({ paused: true }))).toBe(false);
    expect(expose(candidate({ discoverable: false }))).toBe(false);
    expect(expose(candidate({ restricted: true }))).toBe(false);
    expect(expose(candidate({ verified: false }))).toBe(false);
    expect(expose(candidate({ verified: false }), undefined, { ...viewer, verifiedOnly: false })).toBe(true);
  });
  it("a paused or unverified viewer sees nobody", () => {
    expect(expose(candidate(), undefined, { ...viewer, paused: true })).toBe(false);
    expect(expose(candidate(), undefined, { ...viewer, verified: false })).toBe(false);
  });
  it("region scopes resolve through the supplied catalog", () => {
    const west: ViewerPolicy = { ...viewer, outboundMode: "REGION", selectedRegions: ["AF-W"] };
    expect(expose(candidate({ verifiedCountryCode: "NG" }), undefined, west)).toBe(true);
    expect(expose(candidate({ verifiedCountryCode: "CA" }), undefined, west)).toBe(false);
    expect(expose(candidate({ inboundMode: "REGION", inboundRegions: ["NA"] }))).toBe(true);
    expect(expose(candidate({ inboundMode: "REGION", inboundRegions: ["AF-W"] }))).toBe(false);
  });
});

describe("filter validation", () => {
  it("normalizes and de-duplicates", () => {
    expect(validateFilters({ countries: ["gh", "GH"], languages: ["English", "english"], query: "  ama  " }))
      .toEqual({ countries: ["GH"], languages: ["english"], query: "ama" });
  });
  it("rejects unknown keys, bad countries, injection-shaped tokens and online-now", () => {
    expect(() => validateFilters({ scope: "GLOBAL" })).toThrow(/UNKNOWN_FILTER/);
    expect(() => validateFilters({ countries: ["USA"] })).toThrow(/INVALID_COUNTRY_FILTER/);
    expect(() => validateFilters({ interests: ["x'; DROP TABLE users;--"] })).toThrow(/INVALID_INTERESTS_FILTER/);
    expect(() => validateFilters({ onlineOnly: true })).toThrow(/ONLINE_DISCOVERY_UNAVAILABLE/);
    expect(() => validateFilters(null)).toThrow(/INVALID_FILTERS/);
  });
  it("canonical form ignores key and array order", () => {
    expect(canonicalFilters({ languages: ["b", "a"], query: "x" })).toBe(canonicalFilters({ query: "x", languages: ["a", "b"] }));
  });
  it("maps legacy saved-search filters", () => {
    expect(savedFiltersToDiscovery({ q: "Ama", country: "gh", language: "English", onlineOnly: false })).toEqual({ query: "Ama", countries: ["GH"], languages: ["english"] });
  });
});

describe("pagination cursors", () => {
  const key = cursorKey({ JWT_HS256_SECRET: "test-secret-that-is-at-least-32-bytes-long" });
  const expected = { pv: 3, fh: "abc" };
  const token = (over = {}) => encodeCursor(key, { o: 10, pv: 3, fh: "abc", iat: Date.now(), ...over });

  it("round-trips", () => expect(decodeCursor(key, token(), expected).o).toBe(10));
  it("rejects tampering and a different key", () => {
    const [body, sig] = token().split(".");
    const forged = Buffer.from(JSON.stringify({ o: 0, pv: 3, fh: "abc", iat: Date.now() })).toString("base64url");
    expect(() => decodeCursor(key, `${forged}.${sig}`, expected)).toThrow(/INVALID_CURSOR/);
    expect(() => decodeCursor(cursorKey({ JWT_HS256_SECRET: "another-secret-that-is-at-least-32-bytes" }), `${body}.${sig}`, expected)).toThrow(/INVALID_CURSOR/);
  });
  it("rejects expired, stale-policy and other-filter cursors", () => {
    expect(() => decodeCursor(key, token({ iat: Date.now() - 16 * 60_000 }), expected)).toThrow(/CURSOR_EXPIRED/);
    expect(() => decodeCursor(key, token({ pv: 2 }), expected)).toThrow(/CURSOR_STALE/);
    expect(() => decodeCursor(key, token({ fh: "zzz" }), expected)).toThrow(/CURSOR_FILTER_MISMATCH/);
  });
});

describe("ranking", () => {
  const me = { languages: ["English"], interests: ["Technology", "Travel"], professionCode: "ENGINEER" };
  const base: RankCandidate = { userId: "u2", languages: ["English"], interests: ["Technology"], professionCode: "ENGINEER", verified: true, mutualConnections: 2, profileQuality: 0.8, safetyQuality: 0.9, freshness: 0.7 };

  it("explains its reasons", () => {
    const r = rankCandidate(me, base);
    expect(r.reasons).toEqual(expect.arrayContaining(["SHARED_INTERESTS", "SHARED_LANGUAGE", "SIMILAR_PROFESSION", "MUTUAL_CONNECTIONS", "VERIFIED_PROFILE"]));
    expect(r.score).toBeGreaterThan(0);
  });
  it("orders ties by id so results are stable", () => {
    const ids = rankAll(me, ["c", "a", "b"].map((userId) => ({ ...base, userId }))).map((r) => r.userId);
    expect(ids).toEqual(["a", "b", "c"]);
  });
  it("diversification defers rather than drops, so everyone is still reachable", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...base, userId: `u${String(i).padStart(2, "0")}` }));
    const ordered = diversify(rankAll(me, many), 10);
    expect(ordered).toHaveLength(20);
    expect(new Set(ordered.map((r) => r.userId)).size).toBe(20);
    const firstWindow = ordered.slice(0, 10).filter((r) => r.professionCode === "ENGINEER");
    expect(firstWindow.length).toBeLessThanOrEqual(10);
  });
  it("caps one profession per window when others exist", () => {
    const eng = Array.from({ length: 10 }, (_, i) => ({ ...base, userId: `e${i}` }));
    const other = Array.from({ length: 10 }, (_, i) => ({ ...base, userId: `o${i}`, professionCode: `P${i}`, mutualConnections: 0 }));
    const firstTen = diversify(rankAll(me, [...eng, ...other]), 10).slice(0, 10);
    expect(firstTen.filter((r) => r.professionCode === "ENGINEER").length).toBeLessThanOrEqual(4);
  });
});
