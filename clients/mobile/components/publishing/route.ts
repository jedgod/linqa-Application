// OSRM and native Valhalla driving routes for Linqa's map.
export type LatLon = { latitude: number; longitude: number };
export type DrivingRoute = { coords: Array<[number, number]>; meters: number; seconds: number };
export type RoutingConfig = { provider?: string; endpoint?: string; apiKey?: string; apiKeyParam?: string; development?: boolean };
const PUBLIC_OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const MAX_POINTS = 100_000;
const valid = (p: LatLon) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
const development = () => typeof __DEV__ !== 'undefined' && __DEV__;

/** A bad custom URL must never silently send the person's location to a public server. */
export function routingEndpoint(value = process.env.EXPO_PUBLIC_ROUTING_ENDPOINT?.trim(), dev = development()): string {
  const url = new URL(value || PUBLIC_OSRM);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(dev && local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new Error('ROUTING_CONFIGURATION_INVALID');
  return url.toString().replace(/\/?$/, '/');
}
function geojson(raw: unknown): DrivingRoute['coords'] {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_POINTS) throw new Error('NO_ROUTE');
  return raw.map(point => {
    if (!Array.isArray(point) || point.length < 2 || !valid({ longitude: point[0], latitude: point[1] })) throw new Error('NO_ROUTE');
    return [point[1], point[0]] as [number, number];
  });
}
/** Valhalla's default route shape is an encoded polyline with six decimal places. */
export function decodePolyline6(encoded: string): DrivingRoute['coords'] {
  if (!encoded || encoded.length > MAX_POINTS * 14) throw new Error('NO_ROUTE');
  let index = 0, lat = 0, lon = 0;
  const coords: DrivingRoute['coords'] = [];
  const read = () => {
    let result = 0, shift = 0, byte: number;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('NO_ROUTE');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('NO_ROUTE');
      result |= (byte & 31) << shift; shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >>> 1) : result >>> 1;
  };
  while (index < encoded.length) {
    lat += read(); lon += read();
    if (!valid({ latitude: lat / 1e6, longitude: lon / 1e6 }) || coords.length >= MAX_POINTS) throw new Error('NO_ROUTE');
    coords.push([lat / 1e6, lon / 1e6]);
  }
  if (coords.length < 2) throw new Error('NO_ROUTE');
  return coords;
}
function metrics(meters: unknown, seconds: unknown): { meters: number; seconds: number } {
  if (typeof meters !== 'number' || typeof seconds !== 'number' || !Number.isFinite(meters) || !Number.isFinite(seconds) || meters < 0 || seconds < 0) throw new Error('NO_ROUTE');
  return { meters, seconds };
}
export function createRouteClient(config: RoutingConfig, fetcher: typeof fetch = (...args) => fetch(...args)) {
  return async (from: LatLon, to: LatLon, signal?: AbortSignal): Promise<DrivingRoute> => {
    if (!valid(from) || !valid(to)) throw new Error('INVALID_POINT');
    const provider = config.provider || 'osrm';
    if (!['osrm', 'valhalla'].includes(provider) || (provider === 'valhalla' && !config.endpoint)) throw new Error('ROUTING_CONFIGURATION_INVALID');
    const endpoint = routingEndpoint(config.endpoint, config.development ?? development());
    let url: URL;
    const headers: Record<string, string> = { Accept: 'application/json' };
    const init: RequestInit = { headers, redirect: 'error' };
    if (provider === 'valhalla') {
      url = new URL(endpoint.replace(/\/route\/$/, '/') + 'route');
      init.method = 'POST'; headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify({ locations: [from, to].map(p => ({ lat: p.latitude, lon: p.longitude })), costing: 'auto', units: 'kilometers', shape_format: 'polyline6' });
    } else {
      url = new URL(`${endpoint}${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}`);
      url.searchParams.set('overview', 'full'); url.searchParams.set('geometries', 'geojson');
    }
    if (config.apiKey) {
      if (config.apiKeyParam) url.searchParams.set(config.apiKeyParam, config.apiKey);
      else headers.Authorization = `Bearer ${config.apiKey}`;
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 15_000);
    try {
      const response = await fetcher(url.toString(), { ...init, signal: abort.signal });
      if (!response.ok) throw new Error('ROUTE_UNAVAILABLE');
      const json = await response.json();
      if (provider === 'valhalla') {
        const trip = json.trip;
        if (!trip || trip.status !== 0 || !Array.isArray(trip.legs) || trip.legs.length !== 1 || typeof trip.legs[0]?.shape !== 'string') throw new Error('NO_ROUTE');
        const result = metrics(trip.summary?.length, trip.summary?.time);
        return { coords: decodePolyline6(trip.legs[0].shape), ...metrics(result.meters * 1000, result.seconds) };
      }
      const route = json.routes?.[0];
      if (json.code !== 'Ok' || !route) throw new Error('NO_ROUTE');
      return { coords: geojson(route.geometry?.coordinates), ...metrics(route.distance, route.duration) };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  };
}
export const fetchRoute = createRouteClient({
  provider: process.env.EXPO_PUBLIC_ROUTING_PROVIDER?.trim(),
  endpoint: process.env.EXPO_PUBLIC_ROUTING_ENDPOINT?.trim(),
  apiKey: process.env.EXPO_PUBLIC_ROUTING_API_KEY?.trim(),
  apiKeyParam: process.env.EXPO_PUBLIC_ROUTING_API_KEY_PARAM?.trim(),
});
export function distanceText(meters: number): string {
  const miles = meters / 1609.344;
  if (miles >= 0.2) return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
  return `${Math.max(10, Math.round(meters * 3.28084 / 10) * 10)} ft`;
}
export function durationText(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
