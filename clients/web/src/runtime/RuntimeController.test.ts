import { describe, expect, it } from "vitest";
import { RuntimeController } from "./RuntimeController";

describe("RuntimeController", () => {
  it("keeps demo UI available without server or core", async () => {
    const controller = new RuntimeController(
      { health: async () => ({ reachable: false, ready: false }) },
      { info: async () => ({ reachable: false, ready: false, secure: false }) },
      { current: async () => ({ authenticated: false }) },
      {
        mode: () => "DEMO",
        enabled: () => true
      }
    );

    const snapshot = await controller.inspect();

    expect(snapshot.mode).toBe("DEMO");
    expect(snapshot.capabilities.encryptedMessaging.status).toBe("DEMO");
    expect(snapshot.capabilities.encryptedMessaging.enabled).toBe(true);
    expect(snapshot.capabilities.encryptedMessaging.secure).toBe(false);
  });

  it("fails closed in live mode when core is unavailable", async () => {
    const controller = new RuntimeController(
      { health: async () => ({ reachable: true, ready: true }) },
      { info: async () => ({ reachable: false, ready: false, secure: false }) },
      {
        current: async () => ({
          authenticated: true,
          userId: "u1",
          deviceId: "d1"
        })
      },
      {
        mode: () => "LIVE",
        enabled: () => true
      }
    );

    const snapshot = await controller.inspect();

    expect(snapshot.capabilities.encryptedMessaging.enabled).toBe(false);
    expect(snapshot.capabilities.encryptedMessaging.status).toBe("UNAVAILABLE");
  });

  it("activates secure capabilities only when all dependencies are ready", async () => {
    const controller = new RuntimeController(
      {
        health: async () => ({
          reachable: true,
          ready: true,
          version: "1.0.0"
        })
      },
      {
        info: async () => ({
          reachable: true,
          ready: true,
          secure: true,
          apiVersion: "1"
        })
      },
      {
        current: async () => ({
          authenticated: true,
          userId: "u1",
          deviceId: "d1"
        })
      },
      {
        mode: () => "LIVE",
        enabled: () => true
      }
    );

    const snapshot = await controller.inspect();

    expect(snapshot.capabilities.encryptedMessaging.status).toBe("READY");
    expect(snapshot.capabilities.encryptedMessaging.secure).toBe(true);
  });
});
