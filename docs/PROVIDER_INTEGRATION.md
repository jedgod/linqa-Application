# Carrier / Mobile Intelligence Provider Integration

Use at least one production-grade provider capable of:
- E.164 validation;
- carrier lookup;
- mobile network lookup;
- line-type classification;
- VoIP detection;
- disposable/temporary detection where available;
- porting information where permitted;
- SIM-swap or subscriber-risk signals where legally available.

## Fail behavior

Provider unavailable:
- do not mark number VERIFIED_MOBILE;
- return verification temporarily unavailable;
- do not silently accept unknown lines.

Provider returns UNKNOWN:
- REVIEW_REQUIRED or policy-defined secondary lookup.

## Privacy

Do not send more user data than necessary.
For line intelligence, normally only the phone number is required.

Store:
- encrypted E.164;
- SHA-256/HMAC search token;
- last four digits;
- country;
- provider decision;
- line type;
- risk result.

Avoid storing unnecessary raw provider responses.
