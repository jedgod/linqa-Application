# v5 Production Certification

All items are release blockers unless explicitly waived by Security + Product owner with expiry.

1. DB migrations applied to a dedicated staging/test DB.
2. Existing Linqa principal/session adapter verified; no alternate auth system introduced.
3. Trusted installation/device adapter fails closed for revoked/compromised devices.
4. P-256 SPKI and curve validation tests pass.
5. iOS physical-device Face ID/Touch ID gated signing passes.
6. Android physical-device Class 3 biometric gated signing passes.
7. Private key is non-exportable in device test evidence.
8. Production attestation policy configured and verified for supported devices.
9. Challenge expiry test passes.
10. Challenge replay test passes.
11. Signature tamper test passes.
12. Cross-user challenge test fails.
13. Cross-device challenge test fails.
14. Cross-session challenge test fails.
15. Vault grant cannot authorize LinqaSend.
16. LinqaSend grant cannot unlock/export Vault.
17. Transfer amount mutation invalidates grant.
18. Transfer recipient mutation invalidates grant.
19. Quote/version mutation invalidates grant.
20. Cash-out rail/source mutation invalidates grant.
21. Grant replay fails.
22. Credential revocation invalidates pending operations.
23. Recovery epoch invalidates old challenges/grants.
24. Lost-device revoke-all drill passes.
25. High-risk policy denial remains denial after biometric success.
26. Vault business policy can block export after biometric success.
27. Audit chain verification passes.
28. Outbox retry/idempotency tests pass.
29. Metrics/alerts exist for enrollment failure, verify failure, replay, attestation failure and risk denial.
30. Rollback and kill-switch drill passes.
31. Exact Git SHA and artifact SHA-256 are recorded.
32. No face image/template upload endpoint exists.
33. Dependency/SAST/secret scans pass policy.
34. Physical evidence is bound to the release Git SHA.
