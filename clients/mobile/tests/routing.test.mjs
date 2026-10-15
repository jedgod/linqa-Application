import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteClient, decodePolyline6, routingEndpoint } from '../components/publishing/route.ts';
const from = { latitude: 3.85, longitude: -12.02 };
const to = { latitude: 4.07, longitude: -12.095 };
const shape = '_p~iF~ps|U_ulLnnqC';
const osrm = { code: 'Ok', routes: [{ distance: 1200, duration: 95, geometry: { coordinates: [[-12.02, 3.85], [-12.095, 4.07]] } }] };
test('OSRM uses lon/lat input and normalizes GeoJSON into map lat/lon', async () => {
  const client = createRouteClient({ endpoint: 'https://routing.example/route/v1/driving/' }, async (url, init) => {
    assert.match(url, /-12\.020000,3\.850000;-12\.095000,4\.070000/);
    assert.equal(new URL(url).searchParams.get('geometries'), 'geojson');
    assert.equal(init.redirect, 'error');
    return Response.json(osrm);
  });
  assert.deepEqual(await client(from, to), { coords: [[3.85, -12.02], [4.07, -12.095]], meters: 1200, seconds: 95 });
});
test('native Valhalla uses POST, polyline6 and converts kilometers to meters', async () => {
  const client = createRouteClient({ provider: 'valhalla', endpoint: 'https://routing.example/route' }, async (url, init) => {
    assert.equal(url, 'https://routing.example/route');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.deepEqual(body.locations, [{ lat: 3.85, lon: -12.02 }, { lat: 4.07, lon: -12.095 }]);
    assert.equal(body.shape_format, 'polyline6');
    assert.equal(body.units, 'kilometers');
    return Response.json({ trip: { status: 0, summary: { length: 1.2, time: 95 }, legs: [{ shape }] } });
  });
  assert.deepEqual(await client(from, to), { coords: [[3.85, -12.02], [4.07, -12.095]], meters: 1200, seconds: 95 });
});
test('invalid private routing config never falls back to a public server', async () => {
  let calls = 0;
  for (const config of [{ endpoint: 'http://remote.example/' }, { provider: 'valhalla' }, { provider: 'unknown' }, { endpoint: 'https://user:password@routing.example/' }]) {
    await assert.rejects(createRouteClient(config, async () => { calls++; return Response.json(osrm); })(from, to));
  }
  assert.equal(calls, 0);
  assert.throws(() => routingEndpoint('http://127.0.0.1:5000/', false));
  assert.equal(routingEndpoint('http://127.0.0.1:5000/', true), 'http://127.0.0.1:5000/');
});
test('invalid points, bad geometry, missing routes and failed upstreams do not draw a path', async () => {
  const bad = createRouteClient({}, async () => Response.json(osrm));
  await assert.rejects(bad({ latitude: 91, longitude: 0 }, to), /INVALID_POINT/);
  for (const payload of [{ code: 'NoRoute' }, { code: 'Ok', routes: [{ ...osrm.routes[0], distance: -1 }] }, { code: 'Ok', routes: [{ ...osrm.routes[0], geometry: { coordinates: [[0, 0], [0, 91]] } }] }]) {
    await assert.rejects(createRouteClient({}, async () => Response.json(payload))(from, to), /NO_ROUTE/);
  }
  await assert.rejects(createRouteClient({}, async () => new Response('', { status: 503 }))(from, to), /ROUTE_UNAVAILABLE/);
  assert.throws(() => decodePolyline6(shape.slice(0, -1)), /NO_ROUTE/);
});
test('authorization is sent only to the selected routing endpoint', async () => {
  await createRouteClient({ endpoint: 'https://routing.example/', apiKey: 'test-token' }, async (url, init) => {
    assert.equal(new URL(url).hostname, 'routing.example');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    return Response.json(osrm);
  })(from, to);
});
test('a pre-aborted call remains aborted', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(createRouteClient({}, async (_url, init) => { assert.equal(init.signal.aborted, true); throw new Error('aborted'); })(from, to, abort.signal), /aborted/);
});
