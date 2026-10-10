# Implementation order

Existing v1 deployment:
1. Apply `v2_repo_native/002_biometric_repo_native.sql` and wire platform adapters.
2. Apply `v3_transaction_binding/003_biometric_transaction_binding.sql` and move LinqaSend to server-authoritative transfer snapshots.
3. Apply `v4_recovery_attack_resistance/004_biometric_recovery.sql` and wire recovery/revoke-all/outbox.
4. Apply `v5_production_closure/migrations/005_biometric_production_closure.sql` and wire attestation + strict authorization service.
5. Run physical-device and integration certification.
6. Produce evidence JSON and run release gate.

Fresh environment:
- Use `biometric_v5_consolidated.sql`, then wire the same adapters and run the same certification. Do not treat consolidated migration as a shortcut around certification.
