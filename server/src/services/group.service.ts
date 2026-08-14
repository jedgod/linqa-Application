import type { Database } from "../db/pool.js";

export class GroupService {
  constructor(private readonly db: Database) {}

  async appendState(input: {
    groupId: string;
    signerDeviceId: string;
    epoch: number;
    stateCiphertext: Buffer;
    stateHash: Buffer;
    previousStateHash: Buffer | null;
  }) {
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT id, current_epoch, current_state_hash
         FROM groups
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [input.groupId]
      ).then((result) => {
        const row = result.rows[0];
        if (!row) throw new Error("group not found");
        if (input.epoch !== Number(row.current_epoch) + 1) {
          throw new Error("group epoch conflict");
        }
        if (
          row.current_state_hash &&
          (!input.previousStateHash ||
            Buffer.compare(row.current_state_hash, input.previousStateHash) !== 0)
        ) {
          throw new Error("group state chain mismatch");
        }
      });

      const membership = await client.query(
        `SELECT role
         FROM group_memberships
         WHERE group_id = $1
           AND device_id = $2
           AND removed_epoch IS NULL`,
        [input.groupId, input.signerDeviceId]
      );

      if (!["OWNER", "ADMIN"].includes(membership.rows[0]?.role)) {
        throw new Error("device cannot modify group state");
      }

      await client.query(
        `INSERT INTO group_state_events (
           group_id,
           epoch,
           state_ciphertext,
           state_hash,
           previous_state_hash,
           signer_device_id
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          input.groupId,
          input.epoch,
          input.stateCiphertext,
          input.stateHash,
          input.previousStateHash,
          input.signerDeviceId
        ]
      );

      await client.query(
        `UPDATE groups
         SET current_epoch = $2, current_state_hash = $3
         WHERE id = $1`,
        [input.groupId, input.epoch, input.stateHash]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
