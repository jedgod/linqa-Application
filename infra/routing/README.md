# Linqa self-hosted driving routes

Adapted from the saved `Deploy-OSRM-Valhala.txt`. Worldwide coverage is the target; New York was only the original example. These are routing engines, separate from the map tiles drawn by Leaflet.

## This workstation

Measured October 15, 2026: 31.7 GB physical RAM, about 15.5 GiB allocated to Docker, 195.8 GiB free on C:. The [raw OSM planet file](https://planet.openstreetmap.org/pbf/) is currently listed at roughly 89 GB, before graph processing, intermediate files, tiles and updates. A worldwide build has **not** been started.

The launcher applies conservative starting guardrails of 512 GiB free and 64 GiB allocated to Docker for `World`. These are this deployment's guardrails, not universal vendor minimums or a guarantee of sufficient capacity. Size and benchmark the selected engine and update process on a provisioned machine before attempting planet processing. Do not run both planet builds on this workstation.

## Windows installation check

Docker Desktop must run Linux containers. From the Linqa repository in PowerShell:

```powershell
# Tiny Monaco coverage; proves the deployment pipeline, not worldwide coverage.
powershell -NoProfile -ExecutionPolicy Bypass -File infra/routing/Start-Routing.ps1 -Engine osrm -Coverage Smoke -Port 15000
Invoke-RestMethod 'http://127.0.0.1:15000/route/v1/driving/7.4206,43.7311;7.4260,43.7384?overview=full&geometries=geojson'
powershell -NoProfile -ExecutionPolicy Bypass -File infra/routing/Test-Routing.ps1 -Engine osrm -BaseUrl http://127.0.0.1:15000

# Optional native Valhalla check. Its maintained image generates the complete config.
powershell -NoProfile -ExecutionPolicy Bypass -File infra/routing/Start-Routing.ps1 -Engine valhalla -Coverage Smoke -Port 18002
$body = '{"locations":[{"lat":43.7311,"lon":7.4206},{"lat":43.7384,"lon":7.4260}],"costing":"auto","units":"kilometers","shape_format":"polyline6"}'
Invoke-RestMethod 'http://127.0.0.1:18002/route' -Method Post -ContentType 'application/json' -Body $body
```

The launcher verifies downloaded map checksums, resolves image tags to immutable digests, and stores data plus lock files under `.runtime/routing/smoke/` on C:. OSRM runs extract → partition → customize → serve, using the same image digest throughout. Valhalla uses its official scripted image to generate a full compatible configuration and prepare its tiles; wait for the build to finish before testing its API.

Only loopback ports are published. `docker compose ... up` returning does not prove the route service is ready: check the route response, geometry, distance and duration. Logs:

```powershell
docker compose -f infra/routing/compose.yaml --profile osrm logs --tail 50 osrm
docker compose -f infra/routing/compose.yaml --profile valhalla logs --tail 50 valhalla
# Stop a smoke service without removing its map data:
docker compose -f infra/routing/compose.yaml --profile osrm stop osrm
```

## Worldwide deployment

After provisioning sufficient resources, supply a complete planet extract to **one** engine:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infra/routing/Start-Routing.ps1 -Engine osrm -Coverage World -DataRoot 'D:\LinqaRouting' -MapPbf 'D:\Maps\planet.osm.pbf'
# Or allow the large planet download explicitly:
powershell -NoProfile -ExecutionPolicy Bypass -File infra/routing/Start-Routing.ps1 -Engine valhalla -Coverage World -DataRoot 'D:\LinqaRouting' -AllowPlanetDownload
```

Replace paths with the provisioned drive; these are examples, not existing disks. Prefer Docker-managed Linux storage / WSL ext4 for large graphs; Windows bind mounts are convenient for validation but may be slow at planet scale. The launcher does not resize Docker memory, alter your drive, erase data, or purchase hosting.

For Linux, the same Compose file accepts an absolute `ROUTING_DATA_ROOT` path. OSRM must have its prepared `osrm/map.osrm.*` files. For Valhalla place a single planet PBF in `valhalla/`, then start that profile. The official scripted image handles configuration and the tile build. Use a separate staging data directory for updates; verify it before switching serving instances. Keep known-working graph/image pairs for rollback. Avoid serving while replacing graph files in place.

Worldwide data does not imply a drivable route between disconnected islands or across closed borders. This app currently requests automobile routes; transit schedules and live traffic are separate data integrations.

## Connect Linqa

Merge the settings from `clients/mobile/.env.routing.example` into the existing mobile environment. Do not replace unrelated environment settings.

OSRM:

```text
EXPO_PUBLIC_ROUTING_PROVIDER=osrm
EXPO_PUBLIC_ROUTING_ENDPOINT=https://YOUR-ROUTING-HOST/route/v1/driving/
```

Native Valhalla:

```text
EXPO_PUBLIC_ROUTING_PROVIDER=valhalla
EXPO_PUBLIC_ROUTING_ENDPOINT=https://YOUR-ROUTING-HOST/
```

Put a TLS reverse proxy and access controls in front of a public service; the raw engines remain loopback-bound here. Public `EXPO_PUBLIC_*` keys are extractable from an app, so do not embed a private server secret. A production proxy should use short-lived user authorization and rate limiting. Avoid retaining precise route coordinates in access logs.

For an **explicit local debug test only**, reverse the matching port with ADB and use `http://127.0.0.1:15000/route/v1/driving/` (OSRM) or `http://127.0.0.1:18002/` (Valhalla). Reapply forwarding after reconnects. Restart Metro after environment changes. Do not point a production build at localhost or the Monaco graph.

The existing public OSRM demo remains the default only when no endpoint is configured. Invalid custom configuration fails rather than silently sending locations to that public service. The app normalizes OSRM GeoJSON and native Valhalla polyline6 into its existing map contract. This deployment does not automatically change your current mobile endpoint.

## References

- [Official OSRM Docker and MLD instructions](https://github.com/Project-OSRM/osrm-backend)
- [Official Valhalla Docker configuration](https://github.com/valhalla/valhalla/blob/master/docker/README.md)
- [OSM planet downloads](https://planet.openstreetmap.org/pbf/) and [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

Keep OpenStreetMap contributor attribution visible in the map UI. Review source/data licensing for the deployment's use.

## Validation on October 15, 2026

- Six mobile routing tests passed; mobile TypeScript and Compose configuration checks passed.
- World capacity preflight refused this workstation before downloading planet data.
- OSRM Smoke downloaded the checksum-verified Monaco extract, completed extract/partition/customize, started its loopback-only container on port 15000, and returned a valid road route.
- Native Valhalla request/response handling is covered by tests; its Compose profile is validated, but no Valhalla container/tile build was executed in this session.
- No phone was switched to the regional test graph. Worldwide self-hosted routing remains pending provisioned capacity and a planet graph.
