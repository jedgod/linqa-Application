import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = "Linqa_Final_Release_Closure_MANIFEST.json";
const files = [
  ".github/workflows/final-release-closure.yml", "FINAL_GREEN_DEFINITION.md", "FINAL_IMPLEMENTATION_ORDER.md", "README.md",
  "config/evidence-freshness.json", "config/release-closure-policy.json",
  "mobile/device-certification/device-certification.schema.json", "mobile/expo57/scripts/verify-expo57.mjs",
  "ops/device-lab/run-android-certification.sh", "ops/device-lab/run-ios-certification.sh", "ops/device-lab/validate-device-result.mjs",
  "scripts/check-audit-json.mjs", "scripts/merge-device-certifications.mjs", "scripts/refresh-final-release-manifest.mjs", "scripts/scan-release-tests.mjs",
  "server/src/release-closure/dependency-security.ts", "server/src/release-closure/device-certification.ts",
  "server/src/release-closure/evidence-policy.ts", "server/src/release-closure/evidence-reference-integrity.ts", "server/src/release-closure/expo57-migration.ts",
  "server/src/release-closure/final-release-controller.ts", "server/src/release-closure/promotion-policy.ts",
  "server/src/release-closure/release-identity.ts", "server/src/release-closure/skipped-mock-detector.ts",
  "server/src/release-closure/types.ts", "server/src/release-closure/verify-final-cli.ts", "server/src/tests/final-release-closure.test.ts",
  "server/package.json", "clients/mobile/package.json", "clients/mobile/package-lock.json", "clients/mobile/crypto/random-polyfill.ts", "clients/android/app/build.gradle.kts"
];
const manifest = [];
for (const file of files) {
  const bytes = await fs.readFile(path.join(root, file));
  manifest.push({ file: file.replaceAll("\\", "/"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await fs.writeFile(path.join(root, output), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${output} with ${manifest.length} canonical artifacts`);
