/**
 * Single source of truth for the Linqa API base URL.
 *
 * Expo only inlines `process.env.EXPO_PUBLIC_*` when accessed literally, so
 * the lookup below must stay as written. Dev builds fall back to the USB
 * launcher's forwarded port; release builds must be configured explicitly
 * and must use HTTPS.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    const normalized = configured.replace(/\/+$/, "");
    if (!__DEV__ && !/^https:\/\//i.test(normalized)) {
      throw new Error("EXPO_PUBLIC_API_URL must be an HTTPS URL in release builds");
    }
    return normalized;
  }
  if (__DEV__) return "http://127.0.0.1:8080";
  throw new Error("EXPO_PUBLIC_API_URL must be set for release builds");
}
