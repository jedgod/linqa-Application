export type LocationMode = "CITY" | "APPROXIMATE" | "PRECISE";

export interface RawLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export function reduceLocationPrecision(
  location: RawLocation,
  mode: LocationMode
): RawLocation {
  if (mode === "PRECISE") return location;

  const decimals = mode === "APPROXIMATE" ? 2 : 1;
  const factor = 10 ** decimals;

  return {
    latitude: Math.round(location.latitude * factor) / factor,
    longitude: Math.round(location.longitude * factor) / factor,
    accuracyMeters:
      mode === "APPROXIMATE"
        ? Math.max(location.accuracyMeters, 1000)
        : Math.max(location.accuracyMeters, 10_000)
  };
}

export function assertLocationConsent(input: {
  granted: boolean;
  callActive: boolean;
  foreground: boolean;
  foregroundOnly: boolean;
  expiresAt: string;
}): void {
  if (!input.granted) throw new Error("Location consent not granted.");
  if (!input.callActive) throw new Error("Call is not active.");
  if (input.foregroundOnly && !input.foreground) {
    throw new Error("Location sharing requires foreground use.");
  }
  if (new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new Error("Location sharing consent expired.");
  }
}
