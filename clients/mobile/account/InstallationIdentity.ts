import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const INSTALLATION_ID_KEY = "linqa.installation.publicId";

/**
 * Not part of the source pack: generates and persists a random per-device
 * installation identifier once, so the same device always registers as the
 * same device_installations_v2 row across app restarts.
 */
// expo-secure-store's web shim doesn't implement getItemAsync in this SDK —
// see account/AccountContext.tsx for the crash this pattern fixes.
const isWeb = Platform.OS === "web";

export async function getOrCreateInstallationPublicId(): Promise<string> {
  const existing = isWeb ? window.localStorage.getItem(INSTALLATION_ID_KEY) : await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (existing) return existing;

  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  if (isWeb) window.localStorage.setItem(INSTALLATION_ID_KEY, id);
  else await SecureStore.setItemAsync(INSTALLATION_ID_KEY, id);
  return id;
}

export function currentPlatform(): "IOS" | "ANDROID" | "WEB" {
  if (Platform.OS === "ios") return "IOS";
  if (Platform.OS === "android") return "ANDROID";
  return "WEB";
}
