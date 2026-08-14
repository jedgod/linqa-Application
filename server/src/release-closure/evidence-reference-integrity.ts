import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { EvidenceRecord } from "./types.js";

export async function assertEvidenceReferenceIntegrity(evidence: EvidenceRecord[], evidenceRoot: string) {
  const root = resolve(evidenceRoot);
  for (const record of evidence) {
    for (const reference of record.references) {
      if (isAbsolute(reference.path)) throw new Error(`EVIDENCE_REFERENCE_ABSOLUTE_PATH:${record.id}`);
      const target = resolve(root, reference.path);
      const rel = relative(root, target);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`EVIDENCE_REFERENCE_PATH_ESCAPE:${record.id}`);
      let bytes: Buffer;
      try { bytes = await readFile(target); } catch { throw new Error(`EVIDENCE_REFERENCE_MISSING:${record.id}:${reference.path}`); }
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== reference.sha256.toLowerCase()) throw new Error(`EVIDENCE_REFERENCE_HASH_MISMATCH:${record.id}:${reference.path}`);
    }
  }
}
