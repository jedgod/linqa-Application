import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const INSTALLATION_SERVER_ID_KEY = "linqa.installation.serverId";
const isWeb = Platform.OS === "web";

/**
 * Caches the server-assigned installation id returned by
 * MultiAccountApiService.registerInstallation() so screens that manage
 * existing accounts (manage/remove) can reuse it without re-registering
 * the installation on every visit.
 */
export async function cacheInstallationServerId(id: string): Promise<void> {
  if (isWeb) window.localStorage.setItem(INSTALLATION_SERVER_ID_KEY, id);
  else await SecureStore.setItemAsync(INSTALLATION_SERVER_ID_KEY, id);
}

export async function getCachedInstallationServerId(): Promise<string | null> {
  try {
    return isWeb
      ? window.localStorage.getItem(INSTALLATION_SERVER_ID_KEY)
      : await SecureStore.getItemAsync(INSTALLATION_SERVER_ID_KEY);
  } catch {
    return null;
  }
}
