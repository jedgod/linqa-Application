# Server Integration Notes

## Default ports

- API: 8080
- PostgreSQL: 5432

Do not change shipped defaults merely because a local Windows system has a conflict.

Local overrides:

```text
LINQA_API_PORT=8088
LINQA_DATABASE_PORT=55432
```

## Runtime capability endpoint

Register `registerRuntimeRoutes` in the server application.

The web client uses health endpoints for initial availability checks. The capability endpoint can later
provide server feature versions, maintenance states, and minimum client versions.

## Demo compatibility

The web client does not require this server in DEMO mode.
