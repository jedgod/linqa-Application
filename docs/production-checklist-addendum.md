# Production Checklist Addendum: Stages 1–30 Wiring

- [ ] Existing mock UI remains usable in DEMO mode.
- [ ] DEMO mode never shows verified encryption claims.
- [ ] HYBRID mode clearly marks simulated capabilities.
- [ ] LIVE mode fails closed when authentication, server, or core is unavailable.
- [ ] Every stage has an explicit capability state.
- [ ] Feature controls are hidden or disabled through CapabilityGate.
- [ ] Route guards cannot be used as the only server authorization control.
- [ ] Server validates permissions independently.
- [ ] Live service adapters replace demo adapters only after readiness checks.
- [ ] Runtime mode is visible to the user.
- [ ] Windows local port overrides are documented but not shipped as defaults.
- [ ] End-to-end tests cover DEMO, HYBRID, and LIVE transitions.
