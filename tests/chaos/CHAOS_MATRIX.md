# Milestone 3 Chaos Matrix

## PostgreSQL primary unavailable
Expected:
- writes fail closed;
- no false-success message sends;
- readiness fails;
- local outbox remains intact.

## Redis unavailable
Expected:
- cross-node realtime becomes DEGRADED;
- direct DB-backed polling remains available if enabled;
- no ciphertext loss.

## APNs unavailable
Expected:
- push job becomes FAILED_RETRYABLE;
- relay envelope remains durable;
- no plaintext logs.

## FCM unavailable
Same as APNs.

## TURN region unavailable
Expected:
- health marks region unhealthy;
- next region selected;
- relay-only call fails if no healthy region exists.

## CDN unavailable
Expected:
- message remains valid;
- attachment retrieval returns 503;
- ciphertext object remains private.

## Billing provider unavailable
Expected:
- checkout fails explicitly;
- existing entitlements remain unchanged;
- webhook retry is idempotent.

## Enterprise IdP unavailable
Expected:
- existing session policy applies;
- new SSO login fails explicitly;
- no fallback to weaker auth unless policy permits.

## Emergency notifier unavailable
Expected:
- escalation step records FAILED;
- next policy tier may continue;
- no unauthorized recipient substitution.
