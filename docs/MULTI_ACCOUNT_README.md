# Linqa Multi-Account Switching + Genuine Mobile Number Verification Pack
Date: 2026-08-07

This implementation pack adds:

1. Maximum 3 Linqa accounts per trusted device / installation context.
2. Account switching without logging out each account.
3. One unique verified mobile number per Linqa account.
4. International E.164 normalization.
5. Carrier and line-type verification.
6. VoIP / hosted / disposable / temporary / virtual-number rejection.
7. SMS OTP and eligible voice OTP.
8. SIM-swap / porting / velocity / abuse risk inputs.
9. Server-side account-limit enforcement.
10. Isolated cryptographic/storage namespace per account.
11. Isolated access + refresh sessions per account.
12. Isolated push tokens and notification routing.
13. Account switch audit trail.
14. Add-account / remove-account workflow.
15. Tests for 3-account maximum and fourth-account rejection.

## Important

No carrier intelligence service can prove with perfect accuracy that every number
in every country is a physical mobile number. Linqa therefore models explicit
verification states and may require review when provider signals conflict.

Allowed line-type result:
- MOBILE / CELLULAR / WIRELESS

Review:
- UNKNOWN
- MOBILE_PORTED
- PROVIDER_AMBIGUOUS

Reject:
- VOIP
- FIXED_VOIP
- HOSTED
- DISPOSABLE
- TEMPORARY
- VIRTUAL
- TOLL_FREE
- PREMIUM_RATE
- PAGER
- INVALID
