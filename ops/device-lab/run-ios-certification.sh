#!/usr/bin/env bash
set -euo pipefail
: "${GIT_SHA:?}" "${RELEASE_VERSION:?}" "${ARTIFACT_SHA256:?}" "${RELEASE_ARTIFACT:?}" "${LINQA_IOS_DEVICE_UDID:?physical iOS UDID required}" "${LINQA_DEVICE_CERT_RUNNER:?certification runner path required}"
test -x "$LINQA_DEVICE_CERT_RUNNER" || { echo "certification runner is not executable" >&2; exit 1; }
out="release-evidence/current/devices/ios";mkdir -p "$out"
"$LINQA_DEVICE_CERT_RUNNER" ios --udid "$LINQA_IOS_DEVICE_UDID" --artifact "$RELEASE_ARTIFACT" --git-sha "$GIT_SHA" --release-version "$RELEASE_VERSION" --artifact-sha256 "$ARTIFACT_SHA256" --json "$out/result.json"
node ops/device-lab/validate-device-result.mjs "$out/result.json" ios "$GIT_SHA" "$RELEASE_VERSION" "$ARTIFACT_SHA256"
