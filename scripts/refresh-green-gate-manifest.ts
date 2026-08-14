import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const files: Array<[string, string]> = [
  ["G0-G4", ".github/workflows/g0-g4-green-gates.yml"],
  ["G0-G4", "GREEN_LABEL_RULES.md"],
  ["G0-G4", "INTEGRATION_CHECKLIST.md"],
  ["G0-G4", "scripts/generate-gate-evidence.ts"],
  ["G0-G4", "scripts/generate-ci-gate-evidence.ts"],
  ["G0-G4", "scripts/verify-signed-gate-evidence.ts"],
  ["G0-G4", "scripts/assert-green-gates.ts"],
  ["G0-G4", "scripts/refresh-green-gate-manifest.ts"],
  ["G0", "server/src/runtime/artifact-probe.ts"],
  ["G0", "server/src/runtime/bootstrap-gate.ts"],
  ["G0", "server/src/runtime/derived-probe.ts"],
  ["G0", "server/src/runtime/http-probe.ts"],
  ["G0", "server/src/runtime/redis-probe.ts"],
  ["G0", "server/src/runtime/registry-factory.ts"],
  ["G0", "server/src/tests/runtime-capabilities.test.ts"],
  ["G0", "server/src/security/step-up.ts"],
  ["G1", "server/src/routes/auth.ts"],
  ["G1", "server/src/routes/milestone-3.routes.ts"],
  ["G1", "server/src/routes/key-packages.ts"],
  ["G1", "server/src/services/transparency-proof.service.ts"],
  ["G1", "clients/web/src/services/AuthClient.ts"],
  ["G1", "clients/web/src/components/UnifiedAuthForm.tsx"],
  ["G2", "clients/web/src/messaging/ProductionMessagingCoordinator.ts"],
  ["G2", "clients/web/src/services/RelayClient.ts"],
  ["G2", "clients/web/src/messaging/SecureMessagingRuntime.ts"],
  ["G2", "clients/web/src/security/TransparencyVerifier.ts"],
  ["G2", "clients/web/src/storage/EncryptedIndexedDbStore.ts"],
  ["G2", "clients/web/src/storage/EncryptedLocalStore.ts"],
  ["G2", "clients/web/src/components/ChatView.tsx"],
  ["G2", "clients/web/src/messaging/ProductionMessagingCoordinator.test.ts"],
  ["G2", "clients/web/src/security/TransparencyVerifier.test.ts"],
  ["G2", "clients/web/src/storage/EncryptedIndexedDbStore.test.ts"],
  ["G3", "core/src/uniffi_api.rs"],
  ["G3", "core/generated/kotlin/uniffi/linqa_core/linqa_core.kt"],
  ["G3", "core/generated/swift/linqa_core.swift"],
  ["G3", "clients/android/src/security/AndroidKeyCustody.kt"],
  ["G3", "clients/ios/Security/IOSKeyCustody.swift"],
  ["G3", "clients/native/src/NativeSecureCore.ts"],
  ["G4", "server/src/bootstrap/service-container.ts"],
  ["G4", "server/src/config.ts"],
  ["G4", "server/src/db/migrate.ts"],
  ["G4", "server/src/providers/provider-registry.ts"],
  ["G4", "server/src/gates/gate-evidence-writer.ts"],
  ["G4", "server/src/gates/gate-release-controller.ts"],
  ["G4", "server/src/gates/signed-gate-evidence.ts"],
  ["G4", "server/src/gates/types.ts"],
  ["G4", "server/src/tests/gate-evidence.test.ts"],
  ["G4", "server/src/tests/migration-runner.test.ts"],
  ["G4", "server/src/tests/real-providers.test.ts"]
];

const manifest = [];
for (const [gate, file] of files) {
  const data = await readFile(file);
  manifest.push({ gate, file, bytes: data.byteLength, sha256: createHash("sha256").update(data).digest("hex") });
}
await writeFile("Linqa_G0_to_G4_Green_Gate_MANIFEST.json", `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
