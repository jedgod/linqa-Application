// Driving route for the in-app map: the road path from where the person is to the pin, with its distance and time.
//
// HOSTED ROUTING: set EXPO_PUBLIC_ROUTING_ENDPOINT to your own routing server (OSRM, Valhalla's OSRM-compatible endpoint, or any
// service that answers the same /route/v1/driving/{lon,lat;lon,lat}?overview=full&geometries=geojson request), for example
//   EXPO_PUBLIC_ROUTING_ENDPOINT=https://routing.example.com/route/v1/driving/
// and, if that service needs a key, EXPO_PUBLIC_ROUTING_API_KEY (sent as a Bearer token) or EXPO_PUBLIC_ROUTING_API_KEY_PARAM
// (the query-parameter name, e.g. "access_token"). Without them the free public OSRM server is used, which is meant for light
// use only. Only the two coordinates (and the key, if any) are sent.

export type LatLon = { latitude: number; longitude: number };
export type DrivingRoute = { coords: Array<[number, number]>; meters: number; seconds: number };

const PUBLIC_OSRM = "https://router.project-osrm.org/route/v1/driving/";
const configured = process.env.EXPO_PUBLIC_ROUTING_ENDPOINT?.trim();

/** The routing server in use. A configured address must be https and is used with a trailing slash. */
export function routingEndpoint(value: string | undefined = configured): string {
  if (!value) return PUBLIC_OSRM;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return PUBLIC_OSRM;
    return url.toString().replace(/\/?$/, "/");
  } catch {
    return PUBLIC_OSRM;
  }
}
const OSRM = routingEndpoint();
const API_KEY = process.env.EXPO_PUBLIC_ROUTING_API_KEY?.trim();
const API_KEY_PARAM = process.env.EXPO_PUBLIC_ROUTING_API_KEY_PARAM?.trim();

const valid = (p: LatLon) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

export async function fetchRoute(from: LatLon, to: LatLon, signal?: AbortSignal): Promise<DrivingRoute> {
  if (!valid(from) || !valid(to)) throw new Error("INVALID_POINT");
  const key = API_KEY && API_KEY_PARAM ? `&${encodeURIComponent(API_KEY_PARAM)}=${encodeURIComponent(API_KEY)}` : "";
  const url = `${OSRM}${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}?overview=full&geometries=geojson${key}`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  signal?.addEventListener("abort", () => timeout.abort());
  try {
    const response = await fetch(url, { signal: timeout.signal, ...(API_KEY && !API_KEY_PARAM ? { headers: { Authorization: `Bearer ${API_KEY}` } } : {}) });
    if (!response.ok) throw new Error("ROUTE_UNAVAILABLE");
    const json = (await response.json()) as { code?: string; routes?: Array<{ distance: number; duration: number; geometry?: { coordinates?: Array<[number, number]> } }> };
    const route = json.routes?.[0];
    const raw = route?.geometry?.coordinates;
    if (json.code !== "Ok" || !route || !raw?.length) throw new Error("NO_ROUTE");
    // GeoJSON is [longitude, latitude]; the map wants [latitude, longitude]. Anything that is not a number is dropped.
    const coords = raw.filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).slice(0, 20_000).map((c) => [c[1], c[0]] as [number, number]);
    if (coords.length < 2 || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) throw new Error("NO_ROUTE");
    return { coords, meters: route.distance, seconds: route.duration };
  } finally {
    clearTimeout(timer);
  }
}

/** "5.3 mi", "800 ft" */
export function distanceText(meters: number): string {
  const miles = meters / 1609.344;
  if (miles >= 0.2) return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
  return `${Math.max(10, Math.round(meters * 3.28084 / 10) * 10)} ft`;
}

/** "12 min", "1 hr 5 min" */
export function durationText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
