# Final Release Closure Order

1. Freeze the release candidate and its Git revision.
2. Complete and validate Expo 52 to Expo 57 dependency alignment.
3. Resolve or formally accept production-reachable critical/high dependencies.
4. Build once, hash and sign the frozen artifact, and preserve provenance.
5. Complete G0-G5 for the same revision.
6. Run signed release builds on physical Android and iOS devices.
7. Bind every review, device, DR, resilience, canary, and approval artifact to the frozen identity.
8. Reject skipped, todo, mock-provider, emulator, simulator, stale, or mismatched evidence.
9. Advance sequentially through RC candidate, RC frozen, canary, limited availability, and GA.
10. Promote the already-tested artifact without rebuilding.
