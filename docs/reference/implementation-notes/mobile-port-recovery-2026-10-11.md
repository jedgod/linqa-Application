# Mobile development connection recovery ? 2026-10-11

LG USB was offline while its Wi-Fi ADB transport was authorized. The previous watcher ignored Wi-Fi and gated forwarding restoration on backend readiness. The launcher used Metro 8081 while the running server was on 8082.

The route watcher now recognizes LG/Galaxy USB and Wi-Fi transports, reads actual API/Metro ports from launcher state, repairs missing or incorrect routes every two seconds independently of API readiness, and records a heartbeat. The launcher discovers the existing project Metro port, starts a watcher automatically, and supports both known phones. The one-shot recovery script also includes the known phones' Wi-Fi transports. Inbox loading and initial call-room setup retry after failures; foregrounding the app also retries failed setup.

Verified: both phones returned HTTP 200 from phone-side 127.0.0.1:8080, identified as linqa-api ready. Removing each phone's 8080 forwarding rule was repaired automatically by the directly launched watcher. Two route regression tests and mobile TypeScript checking passed. Both clients were refreshed.

A limited current-user Windows logon task, LinqaDevelopmentPhoneRoutes, is registered. Its scheduled Node process reports Running but has not demonstrated a state heartbeat; startup task execution remains unverified. The independently detached watcher is currently providing recovery. Do not claim reboot/sign-in recovery is verified. Local development requires a running API/Metro and a working authorized USB or Wi-Fi ADB transport. USB LG transport remains offline; Wi-Fi is being used. For deployed clients use a reachable HTTPS endpoint rather than a phone loopback address.
