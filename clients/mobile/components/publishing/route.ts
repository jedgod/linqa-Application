// Driving route for the in-app map: the road path from where the person is to the pin, with its distance and time.
// Routing is done by OpenStreetMap's OSRM service (the same OpenStreetMap data the map is drawn from); the phone asks for the
// route directly and only the two coordinates are sent.

export type LatLon = { latitude: number; longitude: number };
export type DrivingRoute = { coords: Array<[number, number]>; meters: number; seconds: number };

const OSRM = "https://router.project-osrm.org/route/v1/driving";

const valid = (p: LatLon) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

export async function fetchRoute(from: LatLon, to: LatLon, signal?: AbortSignal): Promise<DrivingRoute> {
  if (!valid(from) || !valid(to)) throw new Error("INVALID_POINT");
  const url = `${OSRM}/${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}?overview=full&geometries=geojson`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  signal?.addEventListener("abort", () => timeout.abort());
  try {
    const response = await fetch(url, { signal: timeout.signal });
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
