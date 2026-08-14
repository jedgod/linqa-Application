# Final Implementation Order

1. Apply migration 009.
2. Register DeviceEnrollmentService, GapClosureService, and routes.
3. Compile/load the Rust WASM core.
4. Implement a real encrypted local-store adapter.
5. Replace mock send with ProductionMessagingCoordinator.
6. Start OutboxWorker after sign-in and reconnect.
7. Mount CallsPage, MediaGalleryPage, and PrivacyCenterPage.
8. Connect notification and settings forms.
9. Add WebSocket wake-up to receive().
10. Add Android/iOS equivalents.
11. Complete all E2E tests.
12. Remain in HYBRID until every LIVE gate passes.

Status in this repo: 1, 2, and 7 are done. 3-6, 8-11 are not - see
`docs/GAP_CLOSURE_APPLY_GUIDE.md` for the detailed reasoning on each
(missing Rust toolchain, no real IndexedDB implementation supplied,
deliberately not force-wiring an encrypted send path in front of the
working mock demo, and no Android/iOS equivalents of any of this pack's
code exist). 12 is not satisfied: the shipped default runtime mode is
`DEMO`, not `HYBRID`, and no LIVE gate has been exercised end to end.
