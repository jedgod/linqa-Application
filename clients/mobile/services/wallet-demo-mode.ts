import { useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";
import { resetWalletDemo } from "./wallet-demo";

/**
 * Switch for the dev-only wallet demo data. It exists only in debug builds (`__DEV__`): in a release build
 * `walletDemoAvailable` is false, `setWalletDemo` does nothing and `walletDemoEnabled()` can never return true, so the
 * wallet always talks to the real API there. It is off by default and remembered across reloads on the device.
 *
 * The flag and its listeners live on `globalThis`, so a hot reload that re-evaluates this module keeps the same state
 * and the screens already subscribed keep hearing about changes.
 */
const KEY = "linqa.walletDemo";
export const walletDemoAvailable: boolean = typeof __DEV__ !== "undefined" && __DEV__ === true;

type Shared = { enabled: boolean; restored: boolean; listeners: Set<() => void> };
const shared: Shared = ((globalThis as { __linqaWalletDemo?: Shared }).__linqaWalletDemo ??= { enabled: false, restored: false, listeners: new Set() });
const notify = () => shared.listeners.forEach((listener) => listener());

export const walletDemoEnabled = (): boolean => walletDemoAvailable && shared.enabled;

export function setWalletDemo(on: boolean): void {
  if (!walletDemoAvailable || shared.enabled === on) return;
  shared.enabled = on;
  if (on) resetWalletDemo();
  void SecureStore.setItemAsync(KEY, on ? "1" : "0").catch(() => undefined);
  notify();
}

const subscribe = (listener: () => void) => { shared.listeners.add(listener); return () => { shared.listeners.delete(listener); }; };
/** Re-renders when demo mode flips, so a screen can show the banner or reload its data. */
export const useWalletDemo = (): boolean => useSyncExternalStore(subscribe, walletDemoEnabled, walletDemoEnabled);

if (walletDemoAvailable && !shared.restored) {
  shared.restored = true;
  void SecureStore.getItemAsync(KEY).then((value) => {
    if (value === "1" && !shared.enabled) { shared.enabled = true; resetWalletDemo(); notify(); }
  }).catch(() => undefined);
}
