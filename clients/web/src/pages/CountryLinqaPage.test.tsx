import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountryLinqaPage } from "./CountryLinqaPage";

const preferences = { mode: "MY_COUNTRY", verifiedCountryCode: "US", verificationState: "VERIFIED", selectedCountries: [], selectedRegions: [], inboundReach: "MY_COUNTRY", inboundSelectedCountries: [], inboundSelectedRegions: [], locationPrecision: "COUNTRY", showCity: false, showState: false, showCountry: true, verifiedOnly: true, allowBusinesses: true, allowCommunities: true, allowEvents: true, paused: false, subscriptionTier: "FREE", allowedModes: { MY_COUNTRY: true, SELECTED_COUNTRIES: false, REGION: false, GLOBAL: false }, selectionLimits: { countries: 0, regions: 0 } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe("CountryLinqa web workflows", () => {
  let container: HTMLDivElement; let root: Root; let joined: boolean;
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", fetchMock); joined = false;
    fetchMock.mockReset().mockImplementation(async (input: string) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/preferences")) return json(preferences);
      if (path.endsWith("/catalog")) return json({ countries: [{ code: "US", name: "United States" }], regions: [] });
      if (path.endsWith("/feed")) return json({ items: [{ id: "post",body: "A real post from the API" }] });
      if (path.endsWith("/discover/users")) return json({ items: [{ id: "person",display_name: "Ada",verified_country_code: "US" }] });
      if (path.endsWith("/communities/discover")) return json({ items: [{ code: "US",name: "United States",memberCount: 42,joined }] });
      if (path.endsWith("/join")) { joined = true; return json({ joined: true }); }
      if (path.endsWith("/leave")) { joined = false; return json({ left: true }); }
      if (path.endsWith("/saved-searches")) return json({ items: [{ id: "saved",name: "People in USA",filters: { country: "US",verifiedOnly: false } }] });
      return json({ items: [] });
    });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  async function render(token = "first-account") { await act(async () => root.render(<CountryLinqaPage apiBaseUrl="https://linqa.test" accessToken={token} onClose={() => undefined} />)); }
  async function click(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent === label);
    expect(button, `Button ${label}`).toBeDefined(); await act(async () => button!.click());
  }
  function configureSettings(tier: "FREE" | "PREMIUM" | "ELITE" = "PREMIUM") {
    const next = { ...preferences, subscriptionTier: tier, allowedModes: { MY_COUNTRY: true, SELECTED_COUNTRIES: tier !== "FREE", REGION: tier !== "FREE", GLOBAL: tier === "ELITE" }, selectionLimits: { countries: tier === "FREE" ? 0 : 2, regions: tier === "FREE" ? 0 : 1 } };
    const previous = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: string, init: RequestInit = {}) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/preferences")) return json(init.method === "PUT" ? { ...next, ...JSON.parse(init.body as string) } : next);
      if (path.endsWith("/catalog")) return json({ countries: [{ code: "US", name: "United States", callingCode: "+1" }, { code: "CA", name: "Canada", callingCode: "+1" }, { code: "GH", name: "Ghana", callingCode: "+233" }], regions: [{ code: "NA", name: "North America" }, { code: "AF-W", name: "West Africa" }] });
      return previous(input, init);
    });
  }
  function checkbox(name: string) { return Array.from(container.querySelectorAll("label")).find(label => label.textContent?.includes(name))!.querySelector<HTMLInputElement>('input[type="checkbox"]')!; }
  async function selectCountry(name: string) { await act(async () => checkbox(name).click()); }
  async function inputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
    const prototype = input.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); });
  }
  it("searches the server catalog and persists a selection within the server's limit", async () => {
    configureSettings(); await render(); await click("Discovery settings"); await click("Change");
    await selectCountry("United States"); await selectCountry("Canada"); expect(checkbox("Ghana").disabled).toBe(true);
    const searchInput = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await inputValue(searchInput, "Canada"); expect(container.textContent).not.toContain("United States"); expect(container.textContent).toContain("Canada");
    await click("Save selection");
    const call = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")!;
    expect(JSON.parse(call[1].body)).toMatchObject({ mode: "SELECTED_COUNTRIES", selectedCountries: ["US", "CA"], inboundReach: "MY_COUNTRY", inboundSelectedCountries: [] });
    expect(container.textContent).toContain("2 countries selected");
  });
  it("discards canceled picker selections without changing the active reach", async () => {
    configureSettings(); await render(); await click("Discovery settings"); await click("Change"); await selectCountry("Canada");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to Discovery Settings"]')!.click());
    await click("Save changes");
    const call = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")!;
    expect(JSON.parse(call[1].body)).toMatchObject({ mode: "MY_COUNTRY", selectedCountries: [] });
  });
  it("saves inbound regions independently from outbound reach", async () => {
    configureSettings(); await render(); await click("Discovery settings");
    await inputValue(container.querySelector<HTMLSelectElement>('select[aria-label="Who can discover me"]')!, "REGION");
    await selectCountry("West Africa"); expect(checkbox("North America").disabled).toBe(true); await click("Save selection");
    const call = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")!;
    expect(JSON.parse(call[1].body)).toMatchObject({ mode: "MY_COUNTRY", inboundReach: "REGION", inboundSelectedRegions: ["AF-W"], selectedRegions: [] });
  });
  it("previews locked countries and Worldwide without granting paid access", async () => {
    configureSettings("FREE"); await render(); await click("Discovery settings"); await click("Change");
    expect(checkbox("Canada").disabled).toBe(true); expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save selection")!.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Back to Discovery Settings"]')!.click());
    const worldwide = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.startsWith("Worldwide"))!;
    await act(async () => worldwide.click()); expect(container.textContent).toContain("Worldwide discovery requires Elite.");
    await click("View Elite plan"); expect(container.querySelector('.cl-plan-card[aria-pressed="true"]')?.textContent).toContain("Elite");
    await click("Refresh plan access"); expect(container.textContent).toContain("No Premium or Elite entitlement is active yet.");
    expect(fetchMock.mock.calls.every(call => (call[1] as RequestInit)?.method !== "PUT")).toBe(true);
  });
  it("persists Worldwide only for server-confirmed Elite accounts", async () => {
    configureSettings("ELITE"); await render(); await click("Discovery settings");
    await act(async () => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.startsWith("Worldwide"))!.click());
    await click("Save preference");
    const call = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")!;
    expect(JSON.parse(call[1].body)).toMatchObject({ mode: "GLOBAL", inboundReach: "MY_COUNTRY" });
  });
  it("keeps a failed country save on the picker for correction and retry", async () => {
    configureSettings(); const previous = fetchMock.getMockImplementation()!; let fail = true;
    fetchMock.mockImplementation(async (input: string, init: RequestInit = {}) => init.method === "PUT" && fail ? json({ error: "PREFERENCE_SAVE_FAILED" }, 503) : previous(input, init));
    await render(); await click("Discovery settings"); await click("Change"); await selectCountry("Canada"); await click("Save selection");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("PREFERENCE SAVE FAILED"); expect(checkbox("Canada").checked).toBe(true);
    fail = false; await click("Save selection"); expect(container.textContent).toContain("Discovery settings saved");
  });
  it("opens the success screen only after refreshing a confirmed paid entitlement", async () => {
    configureSettings("ELITE"); await render(); await click("Plans"); await click("Refresh plan access");
    expect(container.textContent).toContain("ELITE access is active"); await click("Continue"); expect(container.textContent).toContain("Current Mode");
    await click("Plans"); expect(container.textContent).toContain("Unlock More Connections");
  });
  it("preserves inbound country selections and Contacts Only as separate privacy choices", async () => {
    configureSettings(); await render(); await click("Discovery settings");
    await inputValue(container.querySelector<HTMLSelectElement>('select[aria-label="Who can discover me"]')!, "SELECTED_COUNTRIES");
    await selectCountry("Ghana"); await click("Save selection");
    let calls = fetchMock.mock.calls.filter(call => (call[1] as RequestInit)?.method === "PUT");
    expect(JSON.parse(calls[0][1].body)).toMatchObject({ mode: "MY_COUNTRY", inboundReach: "SELECTED_COUNTRIES", inboundSelectedCountries: ["GH"], selectedCountries: [] });
    await inputValue(container.querySelector<HTMLSelectElement>('select[aria-label="Who can discover me"]')!, "CONTACTS_ONLY"); await click("Save changes");
    calls = fetchMock.mock.calls.filter(call => (call[1] as RequestInit)?.method === "PUT");
    expect(JSON.parse(calls[1][1].body)).toMatchObject({ inboundReach: "CONTACTS_ONLY", inboundSelectedCountries: [] });
  });
  it("locks controls during a pending save and restores them after completion", async () => {
    configureSettings(); const previous = fetchMock.getMockImplementation()!; let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input: string, init: RequestInit = {}) => init.method === "PUT" ? new Promise<Response>(resolve => { finish = resolve; }) : previous(input, init));
    await render(); await click("Discovery settings");
    await act(async () => checkbox("Pause discovery").click()); await click("Save changes");
    expect(checkbox("Pause discovery").matches(":disabled")).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('.countrylinqa-navigation button')!.matches(":disabled")).toBe(true);
    const submitted = JSON.parse(fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT")![1].body);
    expect(submitted.paused).toBe(true);
    await act(async () => finish!(json({ ...preferences, ...submitted })));
    expect(checkbox("Pause discovery").matches(":disabled")).toBe(false);
  });
  it("renders server post bodies and names, then sends explicit false search filters", async () => {
    await render(); expect(container.textContent).toContain("A real post from the API");
    await click("People"); expect(container.textContent).toContain("Ada");
    const verified = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => verified.click());
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const urls = fetchMock.mock.calls.map(call => String(call[0])).filter(value => value.includes("/discover/users")); const url = urls[urls.length - 1];
    expect(new URL(url).searchParams.get("verifiedOnly")).toBe("false");
  });
  it("runs saved searches with their persisted filters", async () => {
    await render(); await click("Saved searches"); expect(container.textContent).toContain("People in USA");
    await click("Run search");
    const urls = fetchMock.mock.calls.map(call => String(call[0])).filter(value => value.includes("/discover/users")); const url = urls[urls.length - 1];
    expect(new URL(url).searchParams.get("country")).toBe("US"); expect(new URL(url).searchParams.get("verifiedOnly")).toBe("false");
  });
  it("joins and leaves communities through the real endpoints", async () => {
    await render(); await click("Communities"); await click("Join community"); expect(container.textContent).toContain("Leave community");
    await click("Leave community"); expect(container.textContent).toContain("Join community");
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/US/join"))).toBe(true);
    expect(fetchMock.mock.calls.some(call => String(call[0]).endsWith("/US/leave"))).toBe(true);
  });
  it("shows server failures with retry instead of an empty-success message", async () => {
    fetchMock.mockImplementation(async (input: string) => new URL(input).pathname.endsWith("/preferences") ? json(preferences) : new URL(input).pathname.endsWith("/catalog") ? json({ countries: [],regions: [] }) : json({ error: "DISCOVERY_UNAVAILABLE" },503));
    await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("DISCOVERY UNAVAILABLE");
    expect(container.textContent).not.toContain("No results yet");
  });
  it("preserves the visibility hierarchy when saving discovery settings", async () => {
    await render(); await click("Discovery settings");
    const city = Array.from(container.querySelectorAll("label")).find(label => label.textContent === "Show city")!.querySelector<HTMLInputElement>("input")!;
    await act(async () => city.click()); await click("Save changes");
    const call = fetchMock.mock.calls.find(call => (call[1] as RequestInit)?.method === "PUT");
    const submitted = JSON.parse((call![1] as RequestInit).body as string);
    expect(submitted).toMatchObject({ showCity: true,showState: true,showCountry: true,locationPrecision: "CITY" });
  });
  it("keeps Free accounts on Free after refreshing plan access", async () => {
    await render(); await click("Plans"); await click("Refresh plan access");
    expect(container.textContent).toContain("No Premium or Elite entitlement is active yet.");
    expect(container.textContent).not.toContain("access is active");
    expect(fetchMock.mock.calls.every(call => (call[1] as RequestInit)?.method !== "PUT")).toBe(true);
  });
  it("discards an old account's delayed response after switching tokens", async () => {
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname;
      if (path.endsWith("/preferences")) return json(preferences);
      if (path.endsWith("/catalog")) return json({ countries: [],regions: [] });
      if ((init.headers as Record<string,string>).authorization === "Bearer first-account") return new Promise<Response>(resolve => { finish = resolve; });
      return json({ items: [{ id: "new",body: "Second account feed" }] });
    });
    await render(); await render("second-account");
    await act(async () => finish!(json({ items: [{ id: "old",body: "First account private data" }] })));
    expect(container.textContent).toContain("Second account feed"); expect(container.textContent).not.toContain("First account private data");
  });
});
