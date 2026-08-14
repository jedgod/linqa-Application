# Multi-Account + Genuine Mobile Acceptance

## Account setup
- Register Account A with genuine Mobile A.
- Register Account B with genuine Mobile B.
- Register Account C with genuine Mobile C.
- Add A/B/C to one trusted device installation.
- Verify slots 1/2/3.

## Fourth account
- Authenticate Account D.
- Attempt add to same installation.
- Server returns ACCOUNT_LIMIT_REACHED.
- No slot/storage namespace/push binding is created.

## Number verification
Test:
- eligible physical mobile line -> OTP_REQUIRED -> VERIFIED_MOBILE;
- known VoIP -> rejected;
- disposable/temporary -> rejected;
- invalid -> rejected;
- ambiguous/unknown -> REVIEW_REQUIRED;
- duplicate verified number -> rejected.

## OTP
- correct 6-digit OTP succeeds;
- expired OTP fails;
- wrong OTP increments attempt counter;
- maximum attempts blocks verification;
- rate limit blocks abuse.

## Account switching
A -> B -> C -> A.
Verify:
- correct profile;
- correct access token;
- correct chats;
- correct Vault;
- correct notifications;
- no data remains visible from previous account.

## Storage isolation
- A secure namespace differs from B/C.
- deleting B local account namespace does not affect A/C.
- cryptographic identity keys are unique.

## Push isolation
- notification for A routes into A context;
- B notification does not appear as A content;
- removing B disables B push binding only.

## Security
- server, not UI, enforces 3-account maximum;
- installation ID alone is not authentication;
- add-account requires fresh authentication;
- tokens never appear in logs;
- E.164 plaintext is encrypted at rest;
- only hashes/suffixes are used for indexes/display.
