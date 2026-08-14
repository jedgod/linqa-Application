import { RawWasmCoreBridge } from "../core/RawWasmCoreBridge";
import { ProductionMessagingCoordinator } from "./ProductionMessagingCoordinator";
import { RelayClient } from "../services/RelayClient";
import { EncryptedIndexedDbStore } from "../storage/EncryptedIndexedDbStore";
import { OutboxWorker } from "./OutboxWorker";
import { RealtimeClient } from "../services/RealtimeClient";

export interface AuthenticatedDeviceIdentity {
  userId: string;
  deviceId: string;
}

/**
 * Boots the production message path and publishes a short-lived signed key
 * package. It fails closed when identity, token, WASM, or publication fails.
 */
export async function initializeSecureMessagingRuntime(input: {
  apiBaseUrl: string;
  accessToken: () => Promise<string>;
  identity: AuthenticatedDeviceIdentity;
  wasmUrl?: string;
}) {
  const core = await RawWasmCoreBridge.load({
    ...input.identity,
    keyStorageNamespace: localStorage.getItem("linqa.installation.id") ?? input.identity.deviceId,
    wasmUrl: input.wasmUrl
  });
  const runtime = await core.runtimeInfo();
  if (!runtime.secureCoreReady) {
    core.dispose();
    throw new Error("Rust secure core did not enter a ready state");
  }

  const relay = new RelayClient(input.apiBaseUrl, input.accessToken);
  await relay.publishKeyPackage(input.identity.deviceId, await core.createKeyPackage());
  const store = new EncryptedIndexedDbStore(`${input.identity.userId}:${input.identity.deviceId}`);
  const coordinator = new ProductionMessagingCoordinator(
    core,
    store,
    relay,
    input.identity,
    (message) => window.dispatchEvent(new CustomEvent("linqa:message-received", { detail: message }))
  );

  const outboxWorker = new OutboxWorker(store, (messageId) => coordinator.retry(messageId));
  const drain = () => void coordinator.receive();
  const onOnline = () => { void outboxWorker.runOnce(); drain(); };
  const retryTimer = window.setInterval(() => void outboxWorker.runOnce(), 3_000);
  const receiveTimer = window.setInterval(drain, 5_000);
  window.addEventListener("online", onOnline);
  const realtimeUrl = new URL("/v1/realtime", input.apiBaseUrl);
  realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";
  const realtime = new RealtimeClient(realtimeUrl.toString(), input.accessToken, drain);
  await realtime.start();
  await Promise.allSettled([outboxWorker.runOnce(), coordinator.receive()]);

  (globalThis as typeof globalThis & { linqaCore?: RawWasmCoreBridge }).linqaCore = core;
  return {
    core, relay, coordinator, runtime,
    stop: () => {
      realtime.stop();
      window.clearInterval(retryTimer);
      window.clearInterval(receiveTimer);
      window.removeEventListener("online", onOnline);
      core.dispose();
    }
  };
}
