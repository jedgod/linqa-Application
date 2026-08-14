import { createHash, sign } from "node:crypto";
import type { Database } from "../db/pool.js";

const leafHash = (sequence: string, objectHash: Buffer) => createHash("sha256")
  .update(Buffer.from("linqa:transparency-leaf:v1\0"))
  .update(Buffer.from(sequence))
  .update(objectHash)
  .digest();

const parentHash = (left: Buffer, right: Buffer) => createHash("sha256")
  .update(Buffer.from([1])).update(left).update(right).digest();

function checkpointPayload(treeSize: number, root: Buffer): Buffer {
  const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(treeSize));
  return Buffer.concat([Buffer.from("linqa:transparency-checkpoint:v1\0"), size, root]);
}

export interface TransparencyInclusionProof {
  algorithm: "SHA256_MERKLE_V1";
  sequence: string;
  leafIndex: number;
  treeSize: number;
  packageHashHex: string;
  rootHashBase64: string;
  siblingsBase64: string[];
  checkpointSignatureBase64: string;
}

export class TransparencyProofService {
  constructor(private readonly db: Database, private readonly checkpointPrivateKeyPem: string) {}

  async proofForPackage(packageHash: Buffer): Promise<TransparencyInclusionProof> {
    const result = await this.db.query(
      `SELECT sequence::text, object_hash FROM key_transparency_events
       WHERE event_type='KEY_PACKAGE_PUBLISHED' ORDER BY sequence ASC`
    );
    const index = result.rows.findIndex((row) => (row.object_hash as Buffer).equals(packageHash));
    if (index < 0) throw new Error("TRANSPARENCY_LEAF_NOT_FOUND");
    let level: Buffer[] = result.rows.map((row) => Buffer.from(leafHash(String(row.sequence), row.object_hash as Buffer)));
    let cursor = index;
    const siblings: Buffer[] = [];
    while (level.length > 1) {
      const siblingIndex = cursor % 2 === 0 ? Math.min(cursor + 1, level.length - 1) : cursor - 1;
      siblings.push(level[siblingIndex]!);
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i]!; const right = level[i + 1] ?? left;
        next.push(parentHash(left, right));
      }
      cursor = Math.floor(cursor / 2); level = next;
    }
    const root = level[0]!;
    return {
      algorithm: "SHA256_MERKLE_V1",
      sequence: String(result.rows[index]!.sequence),
      leafIndex: index,
      treeSize: result.rows.length,
      packageHashHex: packageHash.toString("hex"),
      rootHashBase64: root.toString("base64"),
      siblingsBase64: siblings.map((value) => value.toString("base64")),
      checkpointSignatureBase64: sign(null, checkpointPayload(result.rows.length, root), this.checkpointPrivateKeyPem).toString("base64")
    };
  }
}
