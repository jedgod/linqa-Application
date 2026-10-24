# Linqa Adaptive Navigation v1.1 — Certification Record

Status: **NOT CERTIFIED — REPOSITORY ACCESS AND EXECUTION REQUIRED**

| Gate | Evidence required | Status |
|---|---|---|
| Actual route inventory | route-audit.json from live checkout | PENDING |
| Route registry alignment | every exposed route maps to verified Expo Router page | PENDING |
| Account/onboarding | existing account types, switching and guards tested | PENDING |
| Auth/permissions | unauthorized route links and direct deep links denied | PENDING |
| Mobile navigation | single bottom tab bar, Android back and iOS navigation | PENDING |
| Tablet navigation | compact/expanded layouts, overflow, rotation and split screen | PENDING |
| Desktop navigation | keyboard, browser history, refresh, resize | PENDING |
| Accessibility | TalkBack, VoiceOver, focus, contrast, safe areas | PENDING |
| Typecheck/lint/tests | exact commands and full logs | PENDING |
| Release provenance | exact git SHA, branch, CI run ID, reviewer | PENDING |

## Defect register
- NAV-001: v1.0 illustrative hrefs not verified against repository (BLOCKER).
- NAV-002: v1.0 shell could duplicate existing Expo Router tabs (BLOCKER).
- NAV-003: v1.0 sidebar/breadcrumb presses lack injected account authorization (BLOCKER).
- NAV-004: dynamic route parameters and compact breadcrumb overflow not implemented (BLOCKER).
- NAV-005: no device/CI certification evidence (BLOCKER).

Do not mark any gate passed without artifacts from the actual checkout and environment.
