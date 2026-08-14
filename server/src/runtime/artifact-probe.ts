import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { capability, type CapabilityProbe } from "./capabilities.js";

export class ArtifactHashProbe implements CapabilityProbe {
  constructor(readonly key: string, private readonly path?: string, private readonly expectedSha256?: string) {}
  async probe() {
    if (!this.path || !this.expectedSha256) return capability(this.key, "NOT_CONFIGURED", [], { reason: "artifact path and digest are required" });
    const started = Date.now();
    try {
      const digest = createHash("sha256").update(await readFile(this.path)).digest("hex");
      if (digest.toLowerCase() !== this.expectedSha256.toLowerCase()) {
        return capability(this.key, "DEGRADED", [{ name: this.path, state: "DEGRADED", reason: "artifact digest mismatch" }], { reason: "secure-core artifact digest mismatch" });
      }
      return capability(this.key, "READY", [{ name: this.path, state: "READY", identity: digest }], { version: "verified-artifact" });
    } catch (error) {
      return capability(this.key, "DEGRADED", [{ name: this.path, state: "DEGRADED", reason: String(error) }], { reason: String(error) });
    } finally { void started; }
  }
}
