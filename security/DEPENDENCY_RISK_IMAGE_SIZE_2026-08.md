# Temporary dependency risk: `image-size`

The 2026-08-14 production dependency audit reports GHSA-w3rx-r6r6-pgpr and
GHSA-5p2g-fcmc-qvqq through Expo 57 -> Metro 0.84.4 -> `image-size` 1.2.1.
The GitHub advisories list every released `image-size` version through 2.0.2 as
affected and list no patched release. npm's suggested forced resolution
downgrades Expo to 53 and is rejected as an unsafe breaking change.

Compensating controls:

- `image-size` is reachable through Metro build tooling, not the LINQA API or
  the shipped React Native application runtime.
- CI and release builds consume only reviewed repository assets. Untrusted user
  uploads are never processed by Metro.
- ICNS, JXL, HEIF, and HEIC assets are prohibited from the mobile source tree
  until upstream publishes a patched compatible release.
- The high-severity audit remains visible and release promotion must retain a
  named, time-bounded security acceptance or upgrade to a patched Expo/Metro
  graph. It is not silently ignored.

Review owner and expiry must be supplied by the release authority before GA.
