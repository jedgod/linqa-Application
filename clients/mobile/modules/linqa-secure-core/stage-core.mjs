// Copies the compiled Rust core and its generated Kotlin bindings into this module, and prints the digests the server needs.
// Build the core first:  core/scripts/build-native-bindings.ps1   (Rust, the Android NDK targets, uniffi-bindgen)
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const core = resolve(here, "../../../../core");
const ABIS = { "arm64-v8a": "aarch64-linux-android", "armeabi-v7a": "armv7-linux-androideabi", "x86_64": "x86_64-linux-android" };

const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
let staged = 0;
for (const [abi, target] of Object.entries(ABIS)) {
  const from = join(core, "target", target, "release", "liblinqa_core.so");
  if (!existsSync(from)) { console.warn(`missing ${from} (skipped ${abi})`); continue; }
  const to = join(here, "android/src/main/jniLibs", abi, "liblinqa_core.so");
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`${abi.padEnd(12)} sha256 ${digest(to)}`);
  staged += 1;
}
const kt = join(core, "generated/kotlin/uniffi/linqa_core/linqa_core.kt");
if (!existsSync(kt)) throw new Error(`missing generated Kotlin: ${kt}`);
const ktTo = join(here, "android/src/main/java/uniffi/linqa_core/linqa_core.kt");
mkdirSync(dirname(ktTo), { recursive: true });
copyFileSync(kt, ktTo);
if (staged === 0) throw new Error("no compiled core was found; nothing staged");
console.log(`staged ${staged} ABI(s) and the Kotlin bindings`);
