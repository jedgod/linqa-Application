# GA Architecture

Users / Devices
      |
      v
Global Edge / API Gateway
      |
      +-- Region Resolver
      |      +-- US
      |      +-- EU
      |      +-- APAC
      |
      +-- Auth / Messaging / Calls / Vault / Enterprise / Emergency
      |
      +-- Compliance Control Plane
      |      +-- DSAR
      |      +-- retention
      |      +-- residency
      |      +-- audit evidence
      |
      +-- Operations Control Plane
             +-- incidents
             +-- support
             +-- observability
             +-- release gates
             +-- canary / GA rollout

## Hard rules

- tenant data is processed only in its assigned residency region unless an
  explicitly documented exception is approved;
- privacy deletion jobs are idempotent and auditable;
- support personnel never receive message plaintext or private keys;
- diagnostic exports redact tokens, secrets, message bodies, key material,
  precise location, and payment secrets;
- production release requires independent approver separation of duties;
- critical security findings block GA;
- rollback and kill switch operations are available without a code redeploy.
