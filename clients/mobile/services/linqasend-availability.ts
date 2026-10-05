import { useEffect, useState } from "react";
import { getApiBaseUrl } from "../config/api";
import { accessTokenProvider } from "./session";

const CACHE_MS = 60_000;
let cached: { value: boolean; at: number } | null = null;
let inFlight: Promise<boolean> | null = null;

/**
 * Whether the server allows the LinqaSend money flow to be shown at all.
 * Fails closed: any error, timeout or missing session reads as "unavailable",
 * so a screen can never advertise transfers the readiness gate would refuse.
 */
export async function loadLinqaSendAvailability(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const token = await accessTokenProvider.getAccessToken();
      const response = await fetch(`${getApiBaseUrl()}/v1/linqasend/availability`, {
        headers: { authorization: `Bearer ${token}` }
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { available?: unknown };
      return payload.available === true;
    } catch {
      return false;
    }
  })()
    .then((value) => {
      cached = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** `null` while loading, otherwise the server's answer. Treat null as unavailable. */
export function useLinqaSendAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(cached?.value ?? null);
  useEffect(() => {
    let cancelled = false;
    loadLinqaSendAvailability().then((value) => {
      if (!cancelled) setAvailable(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export function isMoneyRoute(route: string): boolean {
  return route.startsWith("/linqasend");
}

/** Test hook: forget the cached answer. */
export function resetLinqaSendAvailabilityCache(): void {
  cached = null;
  inFlight = null;
}
