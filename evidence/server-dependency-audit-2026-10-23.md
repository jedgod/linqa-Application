# Server dependency audit remediation

Date: 2026-10-23 · Branch: agent/production-module-hardening · Triggering run: Dependency security #26 (commit 479ad62)

## Before (npm audit --omit=dev --audit-level=low)
```
# npm audit report

fast-uri  3.0.0 - 3.1.8 || 4.0.0 - 4.2.2
Severity: moderate
fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding - https://github.com/advisories/GHSA-w74x-v6f9-j3xg
fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding - https://github.com/advisories/GHSA-w74x-v6f9-j3xg
fast-uri vulnerable to improper path equivalence in relative reference normalization - https://github.com/advisories/GHSA-xhq7-xmqj-769h
fast-uri vulnerable to improper path equivalence in relative reference normalization - https://github.com/advisories/GHSA-xhq7-xmqj-769h
fast-uri vulnerable to host confusion via unchecked WHATWG host canonicalization - https://github.com/advisories/GHSA-wjr9-j795-jxcr
fast-uri vulnerable to host confusion via unchecked WHATWG host canonicalization - https://github.com/advisories/GHSA-wjr9-j795-jxcr
fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references - https://github.com/advisories/GHSA-333x-w4r6-6crp
fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references - https://github.com/advisories/GHSA-333x-w4r6-6crp
fix available via `npm audit fix`
node_modules/fast-json-stringify/node_modules/fast-uri
node_modules/fast-uri

fastify  5.12.2 - 5.12.5
fastify is vulnerable to header validation bypass via case-sensitive propertyNames - https://github.com/advisories/GHSA-389g-gv7q-r4x8
fix available via `npm audit fix`
node_modules/fastify

zod  <4.6.6
Severity: high
Zod can exhaust memory while validating oversized constrained collections - https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
fix available via `npm audit fix`
node_modules/zod

3 vulnerabilities (1 low, 1 moderate, 1 high)

To address all issues, run:
  npm audit fix
```

## Action
`npm audit fix` in server/ (no --force). package.json unchanged; package-lock.json only.

| Package | Before | After |
|---|---|---|
| fastify | 5.12.5 | 5.12.7 |
| zod | 4.4.3 | 4.6.7 |
| fast-uri (ajv) | 3.1.8 | 3.1.9 |
| fast-uri (fast-json-stringify) | 4.2.1 | 4.2.3 |

## After
- `npm audit --omit=dev --audit-level=low`: 0 vulnerabilities
- `npm audit --audit-level=high` (CI gate, all deps): 0 vulnerabilities
- `npm run build`: pass
- `npm test` (local, Node 22.18): 950 passed; 2 integration files (historical-sender-key, protected-media) cannot load config here because DATABASE_URL and other secrets are not set; environmental, not dependency-related. CI result is authoritative.
