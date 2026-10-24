# Release gate remediation checklist (G0–G4 and Signed API Image)

Status as of 2026-10-24: **not certified for production.** Code-level checks are green; the evidence gates below are red
**by design** and stay red until real, signed evidence exists. Nothing in this repo may fabricate, stub or bypass that
evidence, and none of the fail-closed controls were weakened while preparing this list.

## What each gate actually verifies

All of this is read from the code (`server/src/gates/signed-gate-evidence.ts`, `scripts/verify-signed-gate-evidence.ts`,
`scripts/security-check.mjs`, `.github/workflows/g0-g4-green-gates.yml`, `.github/workflows/api-image.yml`).

A signed evidence document is accepted only when **all** of these hold:

1. The Ed25519 signature over `payloadBase64` verifies against `LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM`.
2. `payload.gate` equals the gate being verified.
3. `payload.revision` equals the **exact commit SHA under test** (`GIT_SHA`). Evidence is therefore single-use per commit:
   any new commit, including a documentation change, invalidates it.
4. `payload.environment` is `production-equivalent` or `production` (never `staging`).
5. Every required check is present, `required: true`, `passed: true`, and has at least one `evidenceRefs` entry.

| Gate | Where it runs | Required checks (all must pass) |
|---|---|---|
| G0 | `component-tests` job (ubuntu) | `truthful-failure-injection`, `production-boot-refusal` (generated in CI) |
| G1 | `external-evidence` (matrix) | `fresh-phone-registration`, `device-enrollment`, `signed-key-package`, `transparency-inclusion`, `recovery-email`, `revoked-device` |
| G2 | `external-evidence` (matrix) | `two-client-exchange`, `offline-reconnect`, `sender-restart`, `receiver-restart`, `server-restart`, `replay-rejected`, `tamper-rejected`, `wrong-aad-rejected`, `expired-package-rejected`, `plaintext-rejected`, `duplicate-ack-safe` |
| G3 | `g3-native-build` (macOS) | `uniffi-device-build`, `os-key-custody`, `encrypted-local-db`, `web-native-exchange` (+ an iOS native build and Swift typecheck) |
| G4 | `g4-evidence` (ubuntu) | `central-provider-registry`, `live-provider-health`, `clean-install`, `upgrade-matrix` |

`release-promotion` needs G0, G1, G2, G3 and G4 together, so it stays skipped until all five are real.

## What is missing today (exactly)

The failing steps are the "Download signed ... evidence" steps. They fail because these repository **secrets** are not set
(or their URLs do not serve a valid envelope for the commit under test):

| Secret | Used by | Purpose |
|---|---|---|
| `LINQA_G1_EVIDENCE_URL` | G1 | URL serving the signed G1 envelope |
| `LINQA_G2_EVIDENCE_URL` | G2 | URL serving the signed G2 envelope |
| `LINQA_G3_EVIDENCE_URL` | G3 | URL serving the signed device-farm envelope |
| `LINQA_G4_EVIDENCE_URL` | G4 | URL serving the signed provider/migration envelope |
| `LINQA_EVIDENCE_TOKEN` | G1–G4 | Bearer token for those URLs |
| `LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM` | G1–G4 | Ed25519 **public** key that verifies the envelopes |

The Signed API Image workflow additionally needs these repository **variables** to publish from `main` or a `v*` tag
(it is fail-closed: without them it stops at the first step and publishes nothing, which is correct):

| Variable | Purpose |
|---|---|
| `LINQA_READINESS_PUBLIC_KEY_PEM` | Ed25519 public key for the product-readiness envelope |
| `LINQA_READINESS_ENVELOPE_BASE64` | Signed readiness envelope; must contain `credential_rotation`, `offline_encryption`, `integration_tests`, `docker_validation`, `live_audit`, each `PASS` with artifacts whose SHA-256 matches, `revision` equal to the commit, and `producedAt` within 30 days |

## Remediation checklist

Each item needs a real run on real infrastructure by someone authorised to sign. None of it can be produced from a
developer workstation, and none of it should be mocked.

- [ ] **Decide the signer.** Generate an Ed25519 signing key held by the release owner (HSM/KMS preferred). Publish only
      the public key as `LINQA_EVIDENCE_SIGNING_PUBLIC_KEY_PEM` / `LINQA_READINESS_PUBLIC_KEY_PEM`. Never commit the private key.
- [ ] **Freeze the release commit.** Evidence binds to one SHA. Produce all evidence for the final commit, last.
- [ ] **G1 (production-equivalent environment):** run fresh-phone registration, device enrollment, signed key package
      publication, transparency-log inclusion, recovery-email and revoked-device flows end to end; record artifacts
      (logs, screenshots, transparency proofs) and list them under each check's `evidenceRefs`.
- [ ] **G2:** run the two-client exchange plus the offline/restart and negative cases (replay, tamper, wrong AAD, expired
      package, plaintext, duplicate ack) against a production-equivalent server; attach raw results.
- [ ] **G3:** real-device farm run (UniFFI device build, OS key custody, encrypted local DB, web↔native exchange) on both
      platforms; the macOS job also needs a clean iOS Rust build and Swift typecheck.
- [ ] **G4:** register providers centrally, run live provider health, a clean install, and the upgrade matrix on the
      release candidate.
- [ ] **Sign and host** each envelope (`{payloadBase64, signatureBase64}`) behind the bearer-token URLs and set the six
      secrets above.
- [ ] **Readiness envelope:** produce the five milestones with SHA-256-hashed artifacts, sign it, set the two variables.
- [ ] **Re-run** `G0-G4 Green Gates` and `Signed API Image` on the frozen commit; confirm `release-promotion` runs.
- [ ] **Do not** lower thresholds, add allow-lists, skip jobs, or hard-code "PASS" JSON to turn these green.

## Optional: database certification pack

A pasted "Database G0–G4 Certification Pack" proposes `server/scripts/certify-database-gates.mjs` plus a workflow that
runs shell commands taken from repository variables. It is **not adopted yet**, deliberately:

- An orchestrator that treats "command exited 0" as "gate passed" proves nothing unless each command runs real
  assertions and emits verifiable evidence; its own text says so.
- Reading executable shell commands from editable repository *variables* widens the attack surface; the mapping should be
  checked-in, reviewed code instead.
- Its `G0–G4` names collide with the existing device/production gates above, which would blur which gate is which.

What exists and is already real: migrations apply and replay idempotently on PostgreSQL 18; the wallet/ledger/idempotency
suites run against a disposable database (now wired into `ci.yml`); 1,239 server tests pass against a real database. A
proper database certification should map those, plus tenant-isolation, backup/restore and mobile SQLite
(migration, offline recovery, logout cleanup) tests, to named checks inside the existing signed-evidence format.
