# Linqa release closure pack

This is an integration scaffold, not a release certificate. Do not replace existing G0-G4 verifier or database runner. Review and adapt workflow paths to repository conventions.

1. Commit Secure Core changes on the hardening branch after review; never stage Userscredential.txt.
2. `node scripts/release-preflight.mjs` checks branch and clean tree.
3. `GH_TOKEN=... node scripts/verify-ci-runs.mjs OWNER/REPO FULL_SHA workflow-a.yml,workflow-b.yml` verifies successful authenticated workflow runs; separately inspect job artifacts to prove tests actually ran without skips.
4. Populate a real device evidence manifest from signed device-farm output and verify metadata with `node scripts/verify-device-evidence.mjs manifest.json FULL_SHA`.
5. Existing approved signature verifier remains the final authority. `verify-release-closure.mjs` invokes it and fails closed.
6. Release owner approval and branch protection remain mandatory, external checks. NO-GO until all are completed.

Security: Do not commit API tokens, personal credentials, plaintext messages, or raw cryptographic keys. The workflow intentionally has no production deployment or merge step.
