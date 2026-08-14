import type { Database } from "../db/pool.js";

/**
 * Named MlsGroupProvider (not MlsProvider) to avoid colliding with the
 * existing, lower-level, per-message MlsProvider in mls-provider.ts
 * (createGroup/processCommit/encryptApplicationMessage/
 * decryptApplicationMessage, already wired as services.mls). This is a
 * higher-level, group-lifecycle abstraction (whole-state create/commit
 * with epoch + opaque encrypted state) that a real implementation would
 * eventually build on top of the lower-level provider.
 */
export interface MlsGroupProvider {
  createGroup(input: {
    groupId: string;
    creatorDeviceId: string;
    memberKeyPackages: Uint8Array[];
  }): Promise<{
    epoch: number;
    encryptedState: Uint8Array;
    stateHash: Uint8Array;
  }>;

  applyCommit(input: {
    groupId: string;
    epoch: number;
    encryptedState: Uint8Array;
    commitCiphertext: Uint8Array;
  }): Promise<{
    nextEpoch: number;
    encryptedState: Uint8Array;
    stateHash: Uint8Array;
  }>;
}

export class FailClosedMlsGroupProvider implements MlsGroupProvider {
  async createGroup(): Promise<never> {
    throw new Error("MLS group provider is not configured.");
  }

  async applyCommit(): Promise<never> {
    throw new Error("MLS group provider is not configured.");
  }
}

export class MlsGroupService {
  constructor(
    private readonly db: Database,
    private readonly provider: MlsGroupProvider
  ) {}

  async create(input: { groupId: string; creatorDeviceId: string; memberKeyPackages: Uint8Array[] }) {
    const state = await this.provider.createGroup(input);

    await this.db.query(
      `INSERT INTO group_security_states_v2(
         group_id,current_epoch,encrypted_state,state_hash,signer_device_id
       ) VALUES($1,$2,$3,$4,$5)`,
      [
        input.groupId,
        state.epoch,
        Buffer.from(state.encryptedState),
        Buffer.from(state.stateHash),
        input.creatorDeviceId
      ]
    );

    return state;
  }

  async applyCommit(input: { groupId: string; signerDeviceId: string; commitCiphertext: Uint8Array }) {
    const current = await this.db.query(
      `SELECT * FROM group_security_states_v2
       WHERE group_id=$1
       FOR UPDATE`,
      [input.groupId]
    );

    const row = current.rows[0];
    if (!row) throw new Error("group security state not found");

    const next = await this.provider.applyCommit({
      groupId: input.groupId,
      epoch: Number(row.current_epoch),
      encryptedState: new Uint8Array(row.encrypted_state),
      commitCiphertext: input.commitCiphertext
    });

    if (next.nextEpoch !== Number(row.current_epoch) + 1) {
      throw new Error("invalid MLS epoch progression");
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO group_security_commits_v2(
           group_id,epoch,commit_ciphertext,commit_hash,signer_device_id
         ) VALUES($1,$2,$3,digest($3,'sha256'),$4)`,
        [input.groupId, next.nextEpoch, Buffer.from(input.commitCiphertext), input.signerDeviceId]
      );

      await client.query(
        `UPDATE group_security_states_v2
         SET current_epoch=$2,
             previous_state_hash=state_hash,
             encrypted_state=$3,
             state_hash=$4,
             signer_device_id=$5,
             updated_at=now()
         WHERE group_id=$1`,
        [
          input.groupId,
          next.nextEpoch,
          Buffer.from(next.encryptedState),
          Buffer.from(next.stateHash),
          input.signerDeviceId
        ]
      );

      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
