/** Waze's supported embed options: https://developers.google.com/waze/iframe */
export function buildWazeMapUrl(latitude: number, longitude: number, configuredUrl = process.env.EXPO_PUBLIC_WAZE_EMBED_URL): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("Invalid shared location");
  }
  const base = new URL(configuredUrl?.trim() || "https://embed.waze.com/iframe?zoom=14");
  if (base.protocol !== "https:" || base.hostname !== "embed.waze.com" || base.port || base.username || base.password || !/^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?iframe$/.test(base.pathname)) {
    throw new Error("Waze configuration must use an HTTPS embed.waze.com iframe URL");
  }
  const configuredZoom = Number(base.searchParams.get("zoom") ?? 14);
  const zoom = Number.isInteger(configuredZoom) && configuredZoom >= 3 && configuredZoom <= 17 ? configuredZoom : 14;
  // Rebuild from a whitelist. Names, labels, avatars and identifiers never enter the map URL.
  const result = new URL(`https://embed.waze.com${base.pathname}`);
  result.searchParams.set("zoom", String(zoom));
  result.searchParams.set("lat", String(latitude));
  result.searchParams.set("lon", String(longitude));
  result.searchParams.set("pin", "1");
  return result.toString();
}

export function isWazeMapNavigation(url: string): boolean {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "embed.waze.com" && !parsed.port; }
  catch { return false; }
}

/** Place labels stay in the app. A sender-provided title may contain their name. */
export function wazePlaceLabel(address: string | undefined, title: string | undefined, contactName: string): string {
  const label = address?.trim() || title?.trim() || "Shared location";
  const words = label.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u);
  const names = contactName.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(part => part.length > 1);
  return names.some(part => words.includes(part)) ? "Shared location" : label;
}
