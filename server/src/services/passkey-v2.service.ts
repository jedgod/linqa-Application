import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON
} from "@simplewebauthn/server";
import type { Database } from "../db/pool.js";

export class PasskeyV2Service {
  constructor(
    private readonly db: Database,
    private readonly config: {
      rpName: string;
      rpId: string;
      origins: string[];
    }
  ) {}

  async beginRegistration(user: {
    id: string;
    displayName: string;
  }) {
    const existing = await this.db.query(
      `SELECT id,transports
       FROM webauthn_credentials
       WHERE user_id=$1 AND revoked_at IS NULL`,
      [user.id]
    );

    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userName: user.displayName,
      userDisplayName: user.displayName,
      attestationType: "none",
      excludeCredentials: existing.rows.map((row) => ({
        id: row.id,
        transports: row.transports
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required"
      }
    });

    await this.db.query(
      `INSERT INTO webauthn_challenges(
         user_id,challenge,ceremony,expires_at
       ) VALUES($1,$2,'REGISTRATION',now()+interval '5 minutes')`,
      [user.id, options.challenge]
    );

    return options;
  }

  async finishRegistration(input: {
    userId: string;
    response: RegistrationResponseJSON;
    nickname?: string;
  }) {
    const challenge = await this.consumeChallenge(
      input.userId,
      "REGISTRATION"
    );

    const verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: this.config.origins,
      expectedRPID: this.config.rpId,
      requireUserVerification: true
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("passkey registration verification failed");
    }

    const {
      credential,
      credentialBackedUp,
      credentialDeviceType
    } = verification.registrationInfo;

    await this.db.query(
      `INSERT INTO webauthn_credentials(
         id,user_id,webauthn_user_id,public_key,counter,transports,
         device_type,backed_up,nickname
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT(id) DO NOTHING`,
      [
        credential.id,
        input.userId,
        Buffer.from(input.userId.replace(/-/g, ""), "hex"),
        Buffer.from(credential.publicKey),
        credential.counter,
        credential.transports ?? [],
        credentialDeviceType,
        credentialBackedUp,
        input.nickname ?? null
      ]
    );

    return { verified: true, credentialId: credential.id };
  }

  async beginAuthentication(userId: string) {
    const credentials = await this.db.query(
      `SELECT id,transports
       FROM webauthn_credentials
       WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId]
    );

    if (!credentials.rowCount) {
      throw new Error("no passkey registered");
    }

    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: "required",
      allowCredentials: credentials.rows.map((row) => ({
        id: row.id,
        transports: row.transports
      }))
    });

    await this.db.query(
      `INSERT INTO webauthn_challenges(
         user_id,challenge,ceremony,expires_at
       ) VALUES($1,$2,'AUTHENTICATION',now()+interval '5 minutes')`,
      [userId, options.challenge]
    );

    return options;
  }

  async finishAuthentication(input: {
    userId: string;
    response: AuthenticationResponseJSON;
  }) {
    const challenge = await this.consumeChallenge(
      input.userId,
      "AUTHENTICATION"
    );

    const credential = await this.db.query(
      `SELECT *
       FROM webauthn_credentials
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL`,
      [input.response.id, input.userId]
    );

    const row = credential.rows[0];
    if (!row) throw new Error("passkey credential not found");

    const verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: this.config.origins,
      expectedRPID: this.config.rpId,
      requireUserVerification: true,
      credential: {
        id: row.id,
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.counter),
        transports: row.transports
      }
    });

    if (!verification.verified) {
      throw new Error("passkey authentication verification failed");
    }

    await this.db.query(
      `UPDATE webauthn_credentials
       SET counter=$2,last_used_at=now()
       WHERE id=$1`,
      [row.id, verification.authenticationInfo.newCounter]
    );

    return { verified: true, userId: input.userId };
  }

  private async consumeChallenge(
    userId: string,
    ceremony: "REGISTRATION" | "AUTHENTICATION"
  ): Promise<string> {
    const result = await this.db.query(
      `UPDATE webauthn_challenges
       SET consumed_at=now()
       WHERE id=(
         SELECT id
         FROM webauthn_challenges
         WHERE user_id=$1
           AND ceremony=$2
           AND consumed_at IS NULL
           AND expires_at>now()
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING challenge`,
      [userId, ceremony]
    );

    const challenge = result.rows[0]?.challenge;
    if (!challenge) throw new Error("valid passkey challenge not found");
    return challenge;
  }
}
