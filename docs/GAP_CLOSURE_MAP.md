# Gap Closure Map

| Gap | Closure |
|---|---|
| No real encrypted client-to-client conversation | ProductionMessagingCoordinator |
| No verified enrollment | DeviceEnrollmentService and enrollment API |
| No durable outbox | client_message_state + OutboxWorker |
| No encrypted local persistence contract | EncryptedLocalStore |
| Calls tab absent | Call history API and CallsPage |
| Media gallery absent | Media index API and MediaGalleryPage |
| Privacy Center fragmented | PrivacyCenterService and page |
| Notifications/settings incomplete | versioned preference APIs |
| LIVE mode can expose unfinished paths | LiveCapabilityGuard |
