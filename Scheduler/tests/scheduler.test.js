// End to end: the real components against the mock backend (same join window as the Linqa server).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createMockServer } from "../mock-server.mjs";

let mock;
let base;
let CallScheduler;
let api;

beforeAll(async () => {
  mock = createMockServer();
  await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${mock.server.address().port}`;
  vi.stubEnv("VITE_API_BASE", base);
  api = await import("../src/api.js");
  CallScheduler = (await import("../src/components/CallScheduler.vue")).default;
});

afterAll(() => new Promise((resolve) => mock.server.close(resolve)));

beforeEach(() => {
  api.clearJoinLocks();
  mock.joins.length = 0;
});

const joinsFor = (id) => mock.joins.filter((j) => j.id === id).length;
const buttons = (wrapper) => wrapper.findAll("li").map((li) => ({ title: li.find("p").text(), button: li.find("button") }));

async function mountLoaded() {
  const wrapper = mount(CallScheduler, { attachTo: document.body });
  await vi.waitFor(() => expect(wrapper.findAll("li")).toHaveLength(3));
  return wrapper;
}

describe("scheduled calls from the backend", () => {
  it("lists the real calls, soonest first, and opens Join only inside the window", async () => {
    const wrapper = await mountLoaded();
    const rows = buttons(wrapper);
    expect(rows.map((r) => r.title)).toEqual(["Standup (running)", "Design review", "Weekly sync"]);
    expect(rows.map((r) => r.button.attributes("disabled") === undefined)).toEqual([true, true, false]);
    wrapper.unmount();
  });

  it("shows the ready-to-join banner for a call starting in under 5 minutes", async () => {
    const wrapper = await mountLoaded();
    await vi.waitFor(() => expect(wrapper.text()).toContain("Your call is ready to join"));
    wrapper.unmount();
  });
});

describe("join lock", () => {
  it("joins once when Join is tapped repeatedly", async () => {
    const wrapper = await mountLoaded();
    const design = buttons(wrapper).find((r) => r.title === "Design review").button;
    await design.trigger("click");
    await design.trigger("click");
    await design.trigger("click");
    await vi.waitFor(() => expect(joinsFor("1")).toBe(1));
    await new Promise((r) => setTimeout(r, 100));
    expect(joinsFor("1")).toBe(1);
    expect(design.text()).toBe("Joining...");
    wrapper.unmount();
  });

  it("joins once when the card and the banner are both used", async () => {
    const wrapper = await mountLoaded();
    await vi.waitFor(() => expect(wrapper.text()).toContain("Your call is ready to join"));
    const banner = wrapper.findAll("button").find((b) => b.text() === "Join now");
    const card = buttons(wrapper).find((r) => r.title === "Design review").button;
    await card.trigger("click");
    await banner.trigger("click");
    await new Promise((r) => setTimeout(r, 150));
    expect(joinsFor("1")).toBe(1);
    wrapper.unmount();
  });

  it("frees the lock when the join fails, so the person can try again", async () => {
    const early = await api.joinCall("2"); // "Weekly sync" is 45 minutes away: the server refuses
    expect(early).toMatchObject({ success: false, error: "This call isn't open yet." });
    const again = await api.joinCall("2");
    expect(again.skipped).toBeUndefined();
    expect(joinsFor("2")).toBe(0);
  });

  it("allows another join once the lock has passed", async () => {
    const t = Date.now();
    expect((await api.joinCall("3", t)).success).toBe(true);
    expect((await api.joinCall("3", t + 1000)).skipped).toBe(true);
    expect((await api.joinCall("3", t + api.JOIN_LOCK_MS + 1)).success).toBe(true);
    expect(joinsFor("3")).toBe(2);
  });
});

describe("mock backend rules", () => {
  it("refuses to schedule a call in the past", async () => {
    const response = await fetch(`${base}/calls/scheduled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_at: new Date(Date.now() - 60000).toISOString() }),
    });
    expect(response.status).toBe(400);
  });
});
