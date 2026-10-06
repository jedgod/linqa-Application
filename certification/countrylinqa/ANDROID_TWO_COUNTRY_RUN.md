# Android Two-Country Physical Run

Release SHA: __________
Server artifact SHA-256: __________
APK/AAB SHA-256: __________
Date UTC: __________

Device A:
- model:
- Android:
- account evidence ID:
- verified country:

Device B:
- model:
- Android:
- account evidence ID:
- verified country:

The countries MUST differ.

| Case | Expected | Result | Evidence |
|---|---|---|---|
| My Country | foreign candidate hidden | PENDING | |
| Selected Countries | candidate appears only when mutually permitted | PENDING | |
| Region | only eligible regional candidates | PENDING | |
| Worldwide | inbound privacy still enforced | PENDING | |
| Block | immediate exclusion | PENDING | |
| Restricted user | excluded | PENDING | |
| Pause discovery | stranger discovery excluded | PENDING | |
| Saved search | current policy re-evaluated | PENDING | |
| Pagination | no duplicate/leak | PENDING | |
| Settings change | stale cache cannot leak | PENDING | |
| Redis unavailable | uncached behavior remains correct | PENDING | |
| Account switch | policy/cache isolation preserved | PENDING | |

PASS only when every row has evidence tied to the exact SHA/artifact.

Then copy the results into `evidence.json` (see `evidence.example.json`; the case names map to
`myCountry`, `selectedCountries`, `region`, `worldwide`, `block`, `restrictedUser`, `pauseDiscovery`,
`savedSearch`, `pagination`, `cacheInvalidation`, `redisUnavailable`, `accountSwitch`, plus `inboundPrivacy` and
`advancedFilters`) and run:

    node scripts/countrylinqa-certification.mjs verify countrylinqa-certification-manifest.json certification/countrylinqa/evidence.json

The full procedure is in `docs/countrylinqa/TWO_COUNTRY_PHYSICAL_CERTIFICATION.md`.
