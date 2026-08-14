# Final Checklist — Multi-Account + Genuine Mobile

## Phone
- [ ] E.164 normalization implemented.
- [ ] Country support checked.
- [ ] Carrier lookup connected.
- [ ] Line type lookup connected.
- [ ] Known VoIP rejected.
- [ ] Disposable/temporary rejected.
- [ ] Invalid numbers rejected.
- [ ] Ambiguous numbers go to review.
- [ ] OTP required.
- [ ] OTP retry/attempt limits enabled.
- [ ] Duplicate number registration blocked.

## Accounts
- [ ] Account 1 works.
- [ ] Account 2 works.
- [ ] Account 3 works.
- [ ] Account 4 rejected by server.
- [ ] Removed account frees a slot according to policy.
- [ ] Add-account requires fresh authentication.

## Isolation
- [ ] Separate storage namespace.
- [ ] Separate crypto identity.
- [ ] Separate refresh session.
- [ ] Separate push binding.
- [ ] Separate Vault.
- [ ] Separate notifications.
- [ ] Separate backup state.

## Switching
- [ ] Switch A -> B.
- [ ] Switch B -> C.
- [ ] Switch C -> A.
- [ ] No UI data leakage.
- [ ] Notification tap activates correct account.
- [ ] audit event written.

## Security
- [ ] E.164 encrypted at rest.
- [ ] masked display only.
- [ ] provider unavailable fails closed.
- [ ] rate limits enabled.
- [ ] risk scoring enabled.
- [ ] installation identity is not sufficient authentication.
