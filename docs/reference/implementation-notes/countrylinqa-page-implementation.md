# CountryLinqa page implementation

The five `CountryLinqa™/*.txt` packs named in the implementation request are
reference-only compatibility manifests. They contain no executable pack code.
This implementation extends the live mobile, web, and server sources they identify;
the original manifests and the existing authentication and billing stacks are preserved.

## Page coverage

| Reference area | Live implementation |
| --- | --- |
| Phone/OTP and country onboarding | Existing shared authentication and `clients/mobile/app/onboarding/` flows |
| World | `clients/mobile/app/countrylinqa/world.tsx`, reachable from Home and the Discover hub |
| People, events, businesses, communities, world feed | `countrylinqa/list.tsx`, with distinct content cards, search, paging, empty/error states, and shared navigation |
| Advanced search and results | `countrylinqa/search.tsx`, country/region/language/verified filters, results in the list route |
| Saved searches | `countrylinqa/saved-searches.tsx`, create/run/delete against the authenticated user's API |
| Discovery settings, country selection, region selection, worldwide | `settings/countrylinqa.tsx`; selection saves persist to the server |
| Plans and success | Settings subviews, gated by server-confirmed Free/Premium/Elite entitlements |
| Profile | `countrylinqa/profile.tsx`, edits the canonical `user_profiles` name and biography |
| Account settings and support | Links to the existing account settings and support pages |
| Security | `countrylinqa/security.tsx`, own security events, shared privacy/device controls, and country review |
| Notifications | `countrylinqa/notifications.tsx`, persisted preference controls and delivered-alert history |
| Connections | `countrylinqa/connections.tsx`, send/accept/decline/cancel using existing `contact_requests` |
| Moderation | `countrylinqa/report.tsx`, reports visible people/posts/events/businesses to the existing moderation queue |
| Post/event creation | Existing create page connected to publishing endpoints, now requiring an enabled verified country at insertion |
| Web | `clients/web/src/pages/CountryLinqaPage.tsx`, opened from the CountryLinqa sidebar entry; uses the same client and APIs |

These are Expo mobile and React web changes. The separate native Kotlin and Swift
applications are not claimed to have all the new Expo page workflows.

## Discovery Settings pages 1–6 augmentation

The executable React UI in
`CountryLinqa™/CountryLinqa_Discovery_Settings_1_to_6_FULL_UI` supplies the design
for the six settings screens. Its layouts are adapted into
`clients/web/src/pages/CountryLinqaDiscoverySettings.tsx` and the existing Expo
`settings/countrylinqa.tsx` route. The original reference folder is preserved.

- Current Mode shows the verified country name or selected reach from the live catalog.
- Privacy, recommendations, inbound reach, and pause controls use the existing preference API.
- Country and region pickers search the live catalog, enforce server-reported limits,
  keep temporary selections separate from saved settings, and persist only on Save.
- Outbound and inbound selections remain independent. Back cancels picker changes.
- Worldwide includes an Elite lock preview, with server-confirmed access required to save.
- Selectable plan cards compare available features; they do not change subscription state.
  Reference prices and unsupported benefit claims are not treated as real billing data.
- Success is shown only after refreshing a confirmed Premium or Elite entitlement.
- Web layouts adapt to narrow screens, with labeled switches, keyboard-accessible
  selections, focus indicators, loading locks, and recoverable server errors.

Web workflow tests include country search/limits, canceled selections, inbound regions,
locked paid previews, confirmed Worldwide saves, failed-save retry, and paid success
navigation. Mobile typecheck and the existing certification checks cover compatibility.
No connected browser was available for pixel-level or device visual review.

## API and privacy behavior

- Real snake-case people fields and post bodies are normalized by the shared client.
- Search booleans preserve `false`. Unsupported filters are rejected rather than silently ignored.
- People paging uses a UUID cursor with one extra row. The world feed uses chronological
  `(created_at, id)` paging rather than comparing UUIDs against a ranked sort.
- Event/business result pages use bounded offsets, deterministic tie-breakers, and one extra row.
- People, feed, event, and business discovery apply server geographic scope, verification,
  account status, country availability, inbound privacy, and both existing block tables.
- Live subscription status bounds both inbound and outbound reach, even when a paid
  preference was saved before expiration. Preferences report the effective available mode.
- Community discovery respects selected scope and recommendations. Existing memberships remain
  accessible in My Communities when discovery is paused. Suspended memberships cannot be restored by joining.
- Profile, saved searches, connections, notifications, and security reads/writes use the
  authenticated account. The shared client rejects late responses after an account switch.
- Post/event publication checks verification and country feature flags in the insertion query.
- No demo accounts, sample discovery content, fabricated membership numbers, or simulated payments are added.

## Explicit limits

This is a working implementation of the supported page flows, not a claim of full
production certification or exact pixel parity with every mockup.

- Billing checkout and notification delivery still require the application's real providers.
  Plans refresh real entitlements; clicking a plan cannot grant Premium or Elite.
- Online-now, age, gender, interests, religion, profession, and relationship filters are not
  backed by this checkout's CountryLinqa discovery contract. They are not presented as working filters.
- Business discovery reads the existing business and geo-target tables. This change does not
  introduce a business registration system, ratings provider, photo-upload pipeline, or event RSVP system.
- Profile image editing, follow counts, and the image-rich discovery mockups are not implemented here.
- Existing admin and moderation APIs remain available; no new staff console is claimed.
- Database migrations and live provider configuration must already be installed for the underlying
  canonical services. No migration or production data write was run as part of this change.

## Verification

Run mobile typecheck, web build, and server build, plus:

```text
server: npm test -- src/tests/countrylinqa-parity-invariants.test.ts src/tests/countrylinqa-pages.route.test.ts src/tests/unified-auth-onboarding.flows.test.ts src/tests/final-runtime.test.ts
web: npm test -- --run src/services/CountryLinqaClient.test.ts src/pages/CountryLinqaPage.test.tsx
python certification/countrylinqa/check_existing_backend.py
python certification/countrylinqa/check_mobile_parity.py
python certification/countrylinqa/validate_readiness.py
```

Route tests use an injected database stub, not a live PostgreSQL instance. Web interaction
tests use jsdom, including saved searches, joining/leaving, visibility, plan refresh,
failure/retry display, and account-switch isolation. A browser/device visual verification
was not possible because no browser connection was available in this session.
