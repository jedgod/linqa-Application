# Linqa Adaptive Navigation v1.0

Expo Router / React Native responsive navigation starter pack.

## Files
- `navigation.ts`: central route registry and breadcrumb derivation
- `AdaptiveNavigation.tsx`: responsive sidebar, breadcrumbs and mobile navigation shell
- `navigation.test.ts`: registry and breadcrumb tests

## Integration
1. Copy `navigation.ts` and `AdaptiveNavigation.tsx` into `clients/mobile/src/navigation/` (adjust import paths as needed).
2. Wrap the appropriate Expo Router layout's `<Slot />` in `<AdaptiveNavigation>`.
3. Align the `routes` registry with actual routes in your repository. Routes are illustrative and must be verified before shipping.
4. Preserve existing authentication/onboarding/role guards; this shell does not implement authorization.
5. Run typecheck, tests, and physical-device checks for mobile, tablet split-screen and web.

## Production gates
- Validate route names and access guards against repository
- Verify Android back, web browser history, deep links, account switching
- Verify VoiceOver/TalkBack focus order, touch targets, contrast, reduced motion
- Check RTL/localization, safe areas and screen reader breadcrumb announcements
- Validate tablet orientation, resize and split-screen breakpoints
