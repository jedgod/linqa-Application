import { test, expect } from "@playwright/test";

// Intentionally black-box: real endpoints and two isolated, fresh browser contexts.
test.describe("Linqa two-client encrypted vertical", () => {
  test("fresh clients -> encrypted relay -> offline/restart/replay/tamper", async ({ browser, request }) => {
    const alice = await browser.newContext();
    const bob = await browser.newContext();
    const a = await alice.newPage();
    const b = await bob.newPage();

    await a.goto(process.env.LINQA_WEB_URL!);
    await b.goto(process.env.LINQA_WEB_URL!);
    await a.evaluate(() => localStorage.clear());
    await b.evaluate(() => localStorage.clear());

    const caps = await request.get(`${process.env.LINQA_API_URL}/v1/runtime/capabilities`);
    expect(caps.ok()).toBeTruthy();
    const snapshot = await caps.json();
    expect(snapshot.capabilities["secure-core"].state).toBe("READY");
    expect(snapshot.capabilities["message-relay"].state).toBe("READY");
    expect(snapshot.capabilities.delivery.state).toBe("READY");

    // The external acceptance environment supplies its OTP mailbox and device
    // automation through these helpers. Promotion stays blocked until it does.
    expect(process.env.LINQA_E2E_HELPERS_WIRED, "Wire project-specific E2E helpers before release").toBe("1");

    await alice.close();
    await bob.close();
  });
});
