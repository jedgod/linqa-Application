# Recommended route map

## v1
POST /v1/vault/workspace/consumer
POST /v1/vault/uploads
POST /v1/vault/uploads/:id/complete
GET  /v1/vault/files
GET  /v1/vault/files/:id

## v2
POST /v1/vault/imports/social
POST /v1/vault/imports/message
POST /v1/vault/imports/client
GET  /v1/vault/imports/:id/status
POST /v1/vault/imports/:id/confirm

## v3
GET  /v1/vault/plans
POST /v1/vault/billing/change-plan
POST /v1/vault/business/workspaces
POST /v1/vault/business/:id/members
PATCH /v1/vault/business/:id/policy

## v4
POST /v1/vault/private/unlock
POST /v1/vault/exports/social/authorize
POST /v1/vault/exports/:grantId/execute
POST /v1/vault/secure-links
DELETE /v1/vault/secure-links/:id
GET /v1/vault/activity

## v5
GET /v1/vault/health/live
GET /v1/vault/health/ready
Internal workers: intake, scan, export, purge, reconciliation, outbox retry, quota repair, evidence/certification.
