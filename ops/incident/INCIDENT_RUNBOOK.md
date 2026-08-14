# Incident Runbook

## SEV0
Examples:
- widespread account compromise;
- private key exposure;
- cross-tenant data access;
- emergency authorization bypass;
- destructive data corruption.

Actions:
1. declare incident;
2. page incident commander + security + privacy;
3. enable relevant kill switch;
4. freeze high-risk release operations;
5. preserve evidence;
6. start legal/privacy notification assessment;
7. publish customer communication when appropriate.

## SEV1
Examples:
- widespread messaging/call outage;
- authentication outage;
- billing double-charge risk;
- significant push/TURN/CDN degradation.

## Required timeline
- incident declaration;
- mitigation log;
- customer impact;
- security/privacy classification;
- resolution;
- postmortem;
- corrective actions.

Never include message plaintext, private keys, recovery secrets, or payment
credentials in incident tickets or chat channels.
