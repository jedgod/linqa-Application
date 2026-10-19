# Wallet production configuration wiring

`kubernetes-secret-env-injector.yaml` adapts the supplied blueprint to the compiled server image. It supplies the required Deployment selector, a real registry/repository shape, the compiled worker command, non-root permissions, and a read-only custody manifest. The image tag remains an explicit replacement marker. Prefer the certified immutable image digest. The template starts with zero replicas and real money disabled; it is not a deployed or certified production system.

Provision these objects in the existing `linqa-production` namespace through the protected deployment system:

| Object | Required configuration |
| --- | --- |
| Secret `wallet-kms-gateway-secrets` | `provider-url`, `provider-bearer-token`, `kms-key-id`, `kms-region`, with real approved values |
| Secret `wallet-custody-manifest-json` | `custody-accounts.json`, containing the approved `accounts` array described in the custody rollout guide |
| Secret `linqasend-server-runtime` | Full server environment required by `loadConfig`, including database, signing/authentication settings, exact release SHA/artifact hash, certified mode and corridor where required. Explicit container environment values take precedence. |
| ServiceAccount `linqasend-wallet-worker` | Actual cloud workload identity and least-privilege access to the configured KMS key; use the installed cloud provider's identity integration |

Reference the existing namespace and ServiceAccount rather than inventing cloud IAM role IDs or creating broadly privileged roles. Configure registry pull credentials where necessary. No Secret values belong in this repository.

`secretKeyRef` reads an existing Kubernetes Secret. It does **not** pull a cloud secret or enable encryption at rest by itself. The cluster administrator must configure the actual vault synchronizer/CSI integration and cluster encryption separately. See [Kubernetes Secrets](https://kubernetes.io/docs/concepts/configuration/secret/). KMS key configuration does not grant IAM access. Validate the deployed workload identity against the actual key before release; local preflight currently checks KMS configuration presence, not a live KMS encrypt/decrypt round trip.

Before scaling:

1. Render the certified image reference and supply the protected objects above. Apply schema migrations using the bounded migration tooling against the intended database; local development migration results do not migrate production.
2. Run the compiled `node dist/jobs/wallet-provider-preflight.js` in a one-off container with the same environment/identity. The production image contains neither npm nor tsx. It must reach the intended database/gateway. Correct missing or incompatible settings rather than suppressing failures.
3. Run `node dist/jobs/wallet-register-custody.js` with the same environment and mounted manifest to verify and register approved accounts, then rerun preflight. Registration is an explicit audited operation, not an action repeated by every worker replica at startup.
4. Complete existing certification, KYC/custody/payout policy and release gates, including live KMS access validation. Only then explicitly set `LINQASEND_REAL_MONEY_ENABLED` to `"true"` and scale the rendered Deployment to the approved replica count (the supplied blueprint proposes two). The worker intentionally refuses to run while money is disabled.
5. Monitor existing worker/operations telemetry. This process has no HTTP health server; no fictitious HTTP probes, Service, or ingress are created. Review graceful shutdown duration against actual external request and job lease limits.

Environment-backed Secrets require pod replacement to pick up rotation. Coordinate token/key rotation with active operations and the existing KMS ciphertext lifecycle. A changed custody manifest requires explicit validated registration; mounting it alone does not activate accounts.

The `.env.example` gateway/KMS/path entries remain commented, unset placeholders. The strict configuration parser rejects empty strings for optional URLs/keys, so copying active blank assignments would break local configuration. Operators should inject actual settings together; never replace the development database configuration with a fabricated production URL.

No cluster objects, cloud keys, production credentials, money flags or replicas were changed while preparing this template.

## Runtime audit and evidence boundaries

The runtime image includes `scripts/verify-production-readiness.sh`. Run `bash /app/scripts/verify-production-readiness.sh` inside a one-off container or an existing pod with the same protected environment and volume configuration. In a source checkout the root `scripts/verify-production-readiness.sh` forwards to the same implementation. It requires exported environment settings (it does not source `.env`), readable valid manifest JSON, and a successful full wallet preflight. It uses compiled JavaScript in the image, without npm/tsx. It is read-only and does not register or activate the mounted accounts. It deliberately does not print secret values, account references, or manifest contents.

The audit checks configuration/contract readiness; it cannot prove live KMS permissions or encryption, replica failover, k6 results, sustained worker health, or release approval. Those require separate evidence from the intended infrastructure. Use this status mapping instead of treating prepared templates as verified infrastructure:

| Environment | Verified state | Outstanding evidence |
| --- | --- | --- |
| Local development | Migrations 082/083 clean; TypeScript and selected wallet/gateway tests passed | Preflight blocked: gateway/KMS settings and active custody accounts missing |
| Disposable integration tests | Loopback gateway contract tests and isolated PostgreSQL wallet tests passed | No verified deployed integration sandbox, k6 run, or Patroni replica test |
| Staged production | Deployment and audit templates prepared; offline YAML checks passed | Certified image, protected objects, cloud identity/KMS access, production migrations/registration, cluster admission and release gates not verified |

Validation: offline YAML parsing and deployment-wiring assertions passed. `kubectl create --dry-run=client --validate=false` could not complete because the configured API endpoint did not supply Kubernetes resource discovery. Cluster admission/schema validation therefore remains required against the intended production cluster before applying the rendered manifest.
