import { afterEach, describe, expect, it, vi } from "vitest";
import { CountryLinqaService, countryItem } from "../../../mobile/services/countrylinqa.service";

afterEach(() => vi.unstubAllGlobals());
describe("CountryLinqa shared client", () => {
  it("displays the real post body and snake-case people fields", () => {
    expect(countryItem("feed", { id: "p", body: "My first post", createdAt: "2026-10-01" })).toMatchObject({ title: "My first post", body: "My first post" });
    expect(countryItem("people", { id: "u", display_name: "Ada", verified_country_code: "US" })).toMatchObject({ title: "Ada", detail: "US", countryCode: "US" });
    expect(countryItem("people", { id: "u", display_name: "Ada", verified_country_code: null }).countryCode).toBeUndefined();
  });
  it("preserves false filter values, excludes unsupported collection filters, and uses shared authentication", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: "u", display_name: "Ada" }], nextCursor: "next" }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const client = new CountryLinqaService("https://linqa.test", async () => "account-token");
    const result = await client.collection("people", { verifiedOnly: false, q: "Ada & Bob" });
    expect(result.items[0].title).toBe("Ada"); expect(result.nextCursor).toBe("next");
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url); expect(parsed.searchParams.get("verifiedOnly")).toBe("false"); expect(parsed.searchParams.get("q")).toBe("Ada & Bob"); expect(parsed.searchParams.has("period")).toBe(false);
    expect(options.headers).toMatchObject({ authorization: "Bearer account-token" });
  });
  it("propagates server failures instead of rendering an empty success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "COUNTRY_PUBLISHING_UNAVAILABLE" }), { status: 403 })));
    const client = new CountryLinqaService("https://linqa.test", async () => "token");
    await expect(client.createPost("Hello")).rejects.toThrow("COUNTRY_PUBLISHING_UNAVAILABLE");
  });
  it("saves and deletes searches using the real API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "saved" }), { status: 200 })); vi.stubGlobal("fetch", fetchMock);
    const client = new CountryLinqaService("https://linqa.test", async () => "token");
    await client.saveSearch("People", { country: "US", verifiedOnly: false }); await client.deleteSavedSearch("saved");
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][1].body).toBe(JSON.stringify({ name: "People", filters: { country: "US", verifiedOnly: false } })); expect(calls[1][1].method).toBe("DELETE");
  });
  it("rejects a response received after the active account changes", async () => {
    let current = true;
    vi.stubGlobal("fetch", vi.fn(async () => { current = false; return new Response(JSON.stringify({ items: [{ id: "old-account" }] })); }));
    const client = new CountryLinqaService("https://linqa.test", async () => "old-token", () => current);
    await expect(client.collection("people")).rejects.toThrow("Account changed");
  });
});
