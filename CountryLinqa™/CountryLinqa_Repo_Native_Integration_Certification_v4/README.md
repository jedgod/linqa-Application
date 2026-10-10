# CountryLinqa™ Repo-Native Integration + Certification v4

Purpose: integrate the previously designed CountryLinqa v1→v3 packs into the ACTUAL Linqa repository without creating a parallel architecture.

Known live repo anchors:
- server/src/routes/countrylinqa/routes.ts
- server/src/services/countrylinqa/discovery.ts
- server/src/services/countrylinqa/feed-scope.ts
- server/src/services/countrylinqa/service.ts
- server/src/services/countrylinqa/golive/businessRanking.ts
- server/src/services/countrylinqa/golive/eventRanking.ts
- clients/mobile/services/countrylinqa.service.ts
- clients/mobile/app/countrylinqa/{world.tsx,list.tsx,create.tsx}
- clients/mobile/app/settings/countrylinqa.tsx
- clients/mobile/app/onboarding/{country-confirmation.tsx,country-discovery.tsx,complete.tsx,resolve.tsx}
- server/src/tests/countrylinqa-parity-invariants.test.ts
- scripts/unified-onboarding-release-gate.mjs

Known current schema includes 027_countrylinqa_discovery_controls.sql. Do NOT blindly add migration numbers from earlier generic packs. Use the next free migration number in the live repository after inventory.

Known UI/API mismatch to close:
- feed UI expected title while API uses body
- people UI expected displayName/countryCode while API uses display_name/verified_country_code

Certification truth:
- Android Samsung SM-A037U has prior debug install/launch evidence.
- iPhone physical certification is not yet demonstrated.
- v4 therefore contains execution scripts/checklists; it does not mark certification PASS.

Integration rule:
ADAPT v1→v3 concepts into the existing files/tables/routes. Do not copy generic pack files if a live equivalent already exists.
