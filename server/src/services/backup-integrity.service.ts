import { createPublicKey, verify } from "node:crypto";
import type { Database } from "../db/pool.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export class BackupIntegrityService {
  constructor(private readonly db: Database) {}

  async registerManifest(input: {
    userId: string;
    sourceDeviceId: string;
    manifestCiphertext: Buffer;
    manifestHash: Buffer;
    objectKey: string;
    backupVersion: number;
    previousManifestHash?: Buffer;
    signature: Buffer;
  }) {
    const device = await this.db.query(
      `SELECT signing_public_key
       FROM devices
       WHERE id=$1 AND user_id=$2 AND status='ACTIVE'`,
      [input.sourceDeviceId, input.userId]
    );
    if (device.rowCount !== 1 || input.signature.length !== 64) {
      throw new Error("backup signer is not an active device");
    }

    const signedPayload = Buffer.concat([
      Buffer.from("linqa:backup-manifest:v1\0", "utf8"),
      Buffer.from(input.userId, "utf8"),
      Buffer.from([0]),
      Buffer.from(input.sourceDeviceId, "utf8"),
      Buffer.from([0]),
      input.manifestHash,
      input.previousManifestHash ?? Buffer.alloc(0),
      Buffer.from(input.objectKey, "utf8"),
      Buffer.from([0]),
      Buffer.from(String(input.backupVersion), "utf8")
    ]);
    const publicKey = createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        device.rows[0].signing_public_key as Buffer
      ]),
      format: "der",
      type: "spki"
    });
    if (!verify(null, signedPayload, publicKey, input.signature)) {
      throw new Error("backup manifest signature is invalid");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `backup-sequence:${input.userId}`
      ]);
      const current = await client.query(
        `SELECT latest_sequence,latest_manifest_hash
         FROM backup_sequences WHERE user_id=$1 FOR UPDATE`,
        [input.userId]
      );
      const latestSequence = Number(current.rows[0]?.latest_sequence ?? 0);
      const latestHash: Buffer | null = current.rows[0]?.latest_manifest_hash ?? null;
      if (
        latestSequence > 0 &&
        (!latestHash ||
          !input.previousManifestHash ||
          !input.previousManifestHash.equals(latestHash))
      ) {
        throw new Error("backup rollback or chain discontinuity detected");
      }
      if (latestSequence === 0 && input.previousManifestHash) {
        throw new Error("first backup cannot have a predecessor");
      }

      const nextSequence = latestSequence + 1;
      await client.query(
        `INSERT INTO backup_manifests (
           user_id,source_device_id,manifest_ciphertext,manifest_hash,
           object_key,backup_version,status,sequence,previous_manifest_hash,
           signature,completed_at
         ) VALUES($1,$2,$3,$4,$5,$6,'READY',$7,$8,$9,now())`,
        [
          input.userId,
          input.sourceDeviceId,
          input.manifestCiphertext,
          input.manifestHash,
          input.objectKey,
          input.backupVersion,
          nextSequence,
          input.previousManifestHash ?? null,
          input.signature
        ]
      );
      await client.query(
        `INSERT INTO backup_sequences(user_id,latest_sequence,latest_manifest_hash)
         VALUES($1,$2,$3)
         ON CONFLICT(user_id) DO UPDATE SET
           latest_sequence=EXCLUDED.latest_sequence,
           latest_manifest_hash=EXCLUDED.latest_manifest_hash,
           updated_at=now()`,
        [input.userId, nextSequence, input.manifestHash]
      );
      await client.query("COMMIT");
      return { sequence: nextSequence, accepted: true as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}