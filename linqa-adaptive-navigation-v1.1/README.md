# Linqa Adaptive Navigation v1.1 — Repository Integration & Certification

## Status
**Integration candidate only.** No live Linqa repository mutation, device test, or production certification is claimed.

## Package
- `src/navigation.ts`, `src/AdaptiveNavigation.tsx`: v1.0 starter, intentionally not installed automatically.
- `src/navigation-policy.ts`: fail-closed authorization helper for integration with existing account/onboarding gates.
- `src/route-integrity.ts`: duplicate ID/href, missing parent, and cycle detection.
- `scripts/audit-routes.mjs`: inventories Expo Router pages from an existing checkout.
- `tests/route-integrity.test.ts`: proposed Jest tests.
- `evidence/CERTIFICATION.md`: certification checklist and status.

## Integration procedure
1. Checkout the actual Linqa repository and a new branch `agent/adaptive-navigation-v1.1`.
2. Run `node scripts/audit-routes.mjs /path/to/linqa/clients/mobile/app evidence/route-audit.json`.
3. Compare each registry `href` against the generated audit; inspect `(tabs)` groups, redirects, dynamic `[id]` pages, and role-specific routes.
4. **Do not blindly wrap `(tabs)/_layout.tsx`:** inspect the existing Expo Router layout tree and ensure only one tab bar is rendered. Preserve the current account-switch and onboarding guards.
5. Inject the app's existing `canAccessRoute` logic into all sidebar/breadcrumb/tab presses. The included `mayNavigate` is only a conservative helper, not a substitute for server authorization.
6. Replace illustrative hrefs, verify screen-reader accessible breadcrumb overflow, safe areas, and deep links. The v1.0 compact breadcrumbs truncate visually and require an overflow menu before shipping.
7. Run project lint/typecheck/Jest, Android and iOS devices, tablet portrait/landscape/split screen, and web keyboard/browser-history checks.
8. Save exact commit SHA, commands, outputs, device evidence, and failures in the evidence report. Do not claim certified until all gates pass.

## Critical known limitations
- v1.0 shell uses `router.push` for all links and has no route-param resolution, modal guard, or account-aware filtering; adapt it before mounting.
- `usePathname()` and static registry entries alone cannot model dynamic routes or route groups.
- Auth and route authorization must remain enforced by existing Linqa middleware/backend.
- No CI runner, device simulator, repo dependencies, or credentials are included.
