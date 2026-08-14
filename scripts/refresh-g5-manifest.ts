import { createHash } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
const files=[
  ".github/workflows/g5-ga-assurance.yml","G5_GREEN_LABEL_RULES.md","INTEGRATION_ORDER.md","README.md","docs/G5_PRODUCTION_GA_ASSURANCE_STATUS.md","config/g5-gates.example.json",
  "scripts/create-sbom.sh","scripts/sign-release.sh","scripts/extract-evidence-zip.sh","scripts/refresh-g5-manifest.ts",
  "clients/mobile/src/release/MobileReleaseAssurance.ts","server/package.json","server/package-lock.json",
  "server/src/ga/types.ts","server/src/ga/requirements.ts","server/src/ga/evidence-registry.ts","server/src/ga/g5-evidence-writer.ts",
  "server/src/ga/signed-assurance-verifier.ts","server/src/ga/materialize-g5-assurance.ts","server/src/ga/materialize-cli.ts",
  "server/src/ga/ga-release-controller.ts","server/src/ga/verify-ga-cli.ts","server/src/ga/deployment-admission-policy.ts",
  "server/src/ga/assurance-policies.ts","server/src/observability/ga-assurance.ts","server/src/security/kms/production-kms-provider.ts",
  "server/src/security/secrets/secret-rotation-coordinator.ts","server/src/security/siem/security-event-exporter.ts",
  "server/src/tests/g5-assurance.test.ts","server/src/tests/g5-operations.test.ts"
];
const manifest=[];for(const file of files){const data=await readFile(file);manifest.push({gate:"G5",file,bytes:data.byteLength,sha256:createHash("sha256").update(data).digest("hex")});}
await writeFile("Linqa_G5_Production_GA_Assurance_MANIFEST.json",`${JSON.stringify(manifest,null,2)}\n`,`utf8`);
