# Failure Closure Matrix

| Gate | Failure | Correct action |
|---|---|---|
| Inventory | Existing equivalent file/table found | Adapt existing code; do not duplicate |
| Migration | Number collision | Rename to next live migration number |
| DB | Missing column | Add minimal migration only for missing field/index |
| Server build | Import/path mismatch | Correct to live repository module boundaries |
| API contract | snake_case/camelCase mismatch | Fix DTO adapter, not individual screens |
| People discovery | Privacy leak | Fail release; fix mutual eligibility before ranking |
| Feed | `title`/`body` mismatch | Make `body` canonical; temporary adapter only |
| Cache | stale out-of-scope result | Version cache by policy; fail closed |
| Cursor | result leak after policy change | Reject stale policy-version cursor |
| Mobile typecheck | route/component mismatch | Adapt to Expo Router live route |
| Android | UI/runtime failure | Capture logcat + screenshot; patch only observed failure |
| iOS | not physically tested | Keep certification PENDING |
| Certification | dirty Git tree | Refuse manifest |
| Certification | digest mismatch | Rebuild/retest; never rewrite evidence |
