import { randomBytes } from "node:crypto";
import type { Database } from "../db/pool.js";

export class EnrollmentV2Service {
  constructor(private readonly db: Database) {}

  async createChallenge(input: {
    userId: string;
    approvingDeviceId: string;
    requestedDeviceId: string;
  }) {
    const challenge = randomBytes(32);

    const result = await this.db.query(
      `INSERT INTO enrollment_challenges_v2(
         user_id,approving_device_id,requested_device_id,
         challenge,expires_at
       ) VALUES($1,$2,$3,$4,now()+interval '5 minutes')
       RETURNING id,challenge,expires_at`,
      [
        input.userId,
        input.approvingDeviceId,
        input.requestedDeviceId,
        challenge
      ]
    );

    return {
      id: result.rows[0].id,
      challengeBase64: challenge.toString("base64"),
      expiresAt: result.rows[0].expires_at
    };
  }

  async approve(input: {
    userId: string;
    approvingDeviceId: string;
    challengeId: string;
    coreVerified: boolean;
    requestedDeviceKeyPackage: Buffer;
  }) {
    if (!input.coreVerified) {
      throw new Error("core enrollment proof verification failed");
    }

    if (input.requestedDeviceKeyPackage.length < 64) {
      throw new Error("invalid requested-device key package");
    }

    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const challenge = await client.query(
        `UPDATE enrollment_challenges_v2
         SET consumed_at=now(),status='APPROVED'
         WHERE id=$1
           AND user_id=$2
           AND approving_device_id=$3
           AND status='PENDING'
           AND consumed_at IS NULL
           AND expires_at>now()
         RETURNING requested_device_id`,
        [input.challengeId, input.userId, input.approvingDeviceId]
      );

      if (challenge.rowCount !== 1) {
        throw new Error("valid enrollment challenge not found");
      }

      const requestedDeviceId = challenge.rows[0].requested_device_id;

      await client.query(
        `UPDATE devices
         SET status='ACTIVE'
         WHERE id=$1 AND user_id=$2 AND status='PENDING'`,
        [requestedDeviceId, input.userId]
      );

      await client.query(
        `UPDATE key_packages
         SET replaced_at=now()
         WHERE device_id=$1 AND replaced_at IS NULL`,
        [requestedDeviceId]
      );

      await client.query(
        `INSERT INTO key_packages(
           user_id,device_id,package_version,package_bytes,
           package_hash,expires_at
         ) VALUES($1,$2,1,$3,digest($3,'sha256'),now()+interval '30 days')`,
        [input.userId, requestedDeviceId, input.requestedDeviceKeyPackage]
      );

      await client.query("COMMIT");
      return { approved: true, deviceId: requestedDeviceId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
