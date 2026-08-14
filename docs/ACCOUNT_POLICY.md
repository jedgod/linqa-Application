# Linqa Multi-Account Policy

## Maximum accounts

A trusted Linqa device context may hold at most 3 active account memberships.

Example:

Device Installation
├── Account A
├── Account B
└── Account C

Attempting to add Account D returns:

ACCOUNT_LIMIT_REACHED

The limit is enforced server-side.

## Number uniqueness

A normalized verified phone number may belong to only one active Linqa account.

## Number eligibility

A number must:
- parse successfully;
- normalize to E.164;
- map to a supported country;
- pass carrier intelligence;
- be classified as an eligible mobile line;
- not be flagged disposable/temporary/VoIP;
- pass OTP possession verification;
- pass account-abuse risk policy.

## Account isolation

Each account has separate:
- user ID;
- device/account membership;
- access token;
- refresh token;
- notification namespace;
- cryptographic identity;
- encrypted local database namespace;
- Vault namespace;
- backup state;
- MLS state;
- key-transparency state;
- account preferences.

No encryption keys are shared between accounts.
