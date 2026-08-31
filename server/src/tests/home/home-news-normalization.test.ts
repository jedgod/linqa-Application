import { describe, expect, it } from "vitest";
import {
  categoryForHeadline,
  cleanPublisherText,
  toIso2CountryCode,
  toIso639Language,
  toIsoTimestamp
} from "../../home/news-normalization.js";

describe("home news normalization: GDELT timestamp parsing", () => {
  it("parses GDELT's compact seendate, which `new Date()` alone rejects", () => {
    // This is the bug that made the whole feed fail closed: the closure pack
    // handed `seendate` straight to `new Date()`, which yields Invalid Date,
    // so every single article was rejected as INVALID_NEWS_PUBLISHED_AT.
    expect(Number.isFinite(new Date("20260829T010000Z").getTime())).toBe(false);
    expect(toIsoTimestamp("20260829T010000Z")).toBe("2026-08-29T01:00:00.000Z");
  });

  it("still accepts ordinary ISO-8601 from the secondary provider", () => {
    expect(toIsoTimestamp("2026-08-29T01:00:00Z")).toBe("2026-08-29T01:00:00.000Z");
    expect(toIsoTimestamp("2026-08-29T01:00:00.500Z")).toBe("2026-08-29T01:00:00.500Z");
  });

  it("returns undefined for unparseable input so the validator can reject it", () => {
    expect(toIsoTimestamp("not a date")).toBeUndefined();
    expect(toIsoTimestamp("")).toBeUndefined();
    expect(toIsoTimestamp(undefined)).toBeUndefined();
    expect(toIsoTimestamp(1_756_400_000_000)).toBeUndefined();
  });

  it("rejects a malformed compact date rather than coercing it", () => {
    expect(toIsoTimestamp("20261399T010000Z")).toBeUndefined();
  });
});

describe("home news normalization: country codes", () => {
  it("maps GDELT country names onto ISO-3166-1 alpha-2", () => {
    // home_news_articles.country_code is CHAR(2), so storing "United Kingdom"
    // would fail the insert outright.
    expect(toIso2CountryCode("United Kingdom")).toBe("GB");
    expect(toIso2CountryCode("United States")).toBe("US");
    expect(toIso2CountryCode("South Korea")).toBe("KR");
    expect(toIso2CountryCode("Cote d'Ivoire")).toBe("CI");
    expect(toIso2CountryCode("Türkiye")).toBe("TR");
  });

  it("passes through and upper-cases values that are already codes", () => {
    expect(toIso2CountryCode("gb")).toBe("GB");
    expect(toIso2CountryCode("US")).toBe("US");
  });

  it("returns undefined rather than guessing an unknown country", () => {
    expect(toIso2CountryCode("Atlantis")).toBeUndefined();
    expect(toIso2CountryCode("")).toBeUndefined();
    expect(toIso2CountryCode(null)).toBeUndefined();
  });

  it("never returns a value that would overflow CHAR(2)", () => {
    for (const input of ["United Kingdom", "gb", "Papua New Guinea", "Atlantis", "X"]) {
      const code = toIso2CountryCode(input);
      if (code !== undefined) expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("home news normalization: language codes", () => {
  it("maps GDELT language names onto ISO 639-1", () => {
    expect(toIso639Language("English")).toBe("en");
    expect(toIso639Language("Portuguese")).toBe("pt");
  });

  it("passes through existing tags", () => {
    expect(toIso639Language("en")).toBe("en");
    expect(toIso639Language("pt-BR")).toBe("pt-br");
  });

  it("returns undefined for an unknown language", () => {
    expect(toIso639Language("Klingon")).toBeUndefined();
  });
});

describe("home news normalization: publisher text", () => {
  it("strips markup and decodes the entities publishers actually emit", () => {
    expect(cleanPublisherText("<b>Markets</b> rally &amp; bonds slip")).toBe("Markets rally & bonds slip");
    expect(cleanPublisherText("It&#39;s official")).toBe("It's official");
    expect(cleanPublisherText("&quot;Quoted&quot; headline")).toBe("\"Quoted\" headline");
  });

  it("collapses whitespace introduced by tag removal", () => {
    expect(cleanPublisherText("Line\n\nbreak   here")).toBe("Line break here");
  });

  it("does not leave a script body behind when stripping tags", () => {
    const cleaned = cleanPublisherText("Headline<script>alert(1)</script>");
    expect(cleaned).not.toContain("<");
    expect(cleaned).not.toContain(">");
  });
});

describe("home news normalization: category inference", () => {
  it("classifies by headline content", () => {
    expect(categoryForHeadline("Parliament passes new election law")).toBe("POLITICS");
    expect(categoryForHeadline("Semiconductor supply chain shifts")).toBe("TECHNOLOGY");
    expect(categoryForHeadline("Hospital reports vaccine rollout progress")).toBe("HEALTH");
    expect(categoryForHeadline("Champions league final set")).toBe("SPORTS");
  });

  it("falls back to WORLD rather than inventing a category", () => {
    expect(categoryForHeadline("A quiet morning in the harbour")).toBe("WORLD");
  });
});
