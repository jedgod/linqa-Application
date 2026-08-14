import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ReleaseIdentity } from "./types.js";
export async function assertReleaseIdentity(identity:ReleaseIdentity){if(!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(identity.releaseVersion))throw new Error("INVALID_RELEASE_VERSION");if(!/^[a-f0-9]{40,64}$/i.test(identity.gitSha))throw new Error("INVALID_GIT_SHA");if(!/^[a-f0-9]{64}$/i.test(identity.artifactSha256))throw new Error("INVALID_ARTIFACT_SHA256");const actual=createHash("sha256").update(await readFile(identity.artifactPath)).digest("hex");if(actual!==identity.artifactSha256.toLowerCase())throw new Error("RELEASE_ARTIFACT_HASH_MISMATCH");}
