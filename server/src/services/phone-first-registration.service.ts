import { randomBytes } from "node:crypto";
import type { Database } from "../db/pool.js";
import type { AccountLimitService } from "./account-limit.service.js";
import type { SessionIssuer } from "./account-switch.service.js";
import type { PhoneRegistrationService } from "./phone-registration.service.js";
import type { RecoveryEmailService } from "./recovery-email.service.js";

type FlowState =
  | "STARTED"
  | "PHONE_OTP_REQUIRED"
  | "PHONE_REVIEW_REQUIRED"
  | "RECOVERY_EMAIL_REQUIRED"
  | "EMAIL_OTP_REQUIRED"
  | "RECOVERY_EMAIL_VERIFIED"
  | "ACCOUNT_ACTIVATED";

export class PhoneFirstRegistrationService {
  constructor(
    private readonly db: Database,
    private readonly phones: PhoneRegistrationService,
    private readonly recoveryEmails: RecoveryEmailService,
    private readonly limits: AccountLimitService,
    private readonly sessions: SessionIssuer
  ) {}

  async start(input: { installationId: string; userId: string; detectedCountryIso2?: string }) {
    const installation = await this.db.query(
      `SELECT id FROM device_installations_v2 WHERE id=$1 AND trust_state<>'REVOKED'`,
      [input.installationId]
    );
    if (installation.rowCount !== 1) throw new Error("installation_not_found");

    const accounts = await this.db.query(
      `SELECT user_id FROM installation_accounts_v2
       WHERE installation_id=$1 AND state='ACTIVE'`,
      [input.installationId]
    );
    if (accounts.rows.length > 0 && !accounts.rows.some((row) => row.user_id === input.userId)) {
      throw new Error("fresh_account_authentication_required");
    }
    await this.limits.requireCapacity(input.installationId);

    const country = input.detectedCountryIso2?.toUpperCase();
    const result = await this.db.query(
      `INSERT INTO registration_flows_v3(
         provisional_user_id,installation_id,state,
         detected_country_iso2,selected_country_iso2
       ) VALUES($1,$2,'STARTED',$3,$3)
       ON CONFLICT(provisional_user_id,installation_id)
         WHERE state NOT IN ('ACCOUNT_ACTIVATED','FAILED','CANCELLED')
       DO UPDATE SET detected_country_iso2=EXCLUDED.detected_country_iso2,
         selected_country_iso2=EXCLUDED.selected_country_iso2,
         expires_at=now()+interval '30 minutes',updated_at=now()
       RETURNING id,state,detected_country_iso2,expires_at`,
      [input.userId, input.installationId, country ?? null]
    );
    return result.rows[0];
  }

  async submitPhone(input: {
    flowId: string;
    userId: string;
    countryIso2: string;
    nationalNumber: string;
  }) {
    await this.flow(input.flowId, input.userId, ["STARTED", "PHONE_REVIEW_REQUIRED"]);
    try {
      const phone = await this.phones.begin({
        userId: input.userId,
        rawNumber: input.nationalNumber,
        defaultCountry: input.countryIso2.toUpperCase()
      });
      const state: FlowState = phone.state === "REVIEW_REQUIRED"
        ? "PHONE_REVIEW_REQUIRED"
        : "PHONE_OTP_REQUIRED";
      await this.db.query(
        `UPDATE registration_flows_v3 SET state=$2,selected_country_iso2=$3,
           phone_identity_id=$4,updated_at=now() WHERE id=$1`,
        [input.flowId, state, input.countryIso2.toUpperCase(), phone.phoneIdentityId]
      );
      return { ...phone, state };
    } catch (error) {
      const code = error instanceof Error ? error.message : "phone_registration_failed";
      await this.db.query(
        `UPDATE registration_flows_v3 SET state='FAILED',failure_code=$2,updated_at=now() WHERE id=$1`,
        [input.flowId, code]
      );
      throw error;
    }
  }

  async verifyPhone(input: {
    flowId: string;
    userId: string;
    phoneIdentityId: string;
    challengeId: string;
    code: string;
  }) {
    const flow = await this.flow(input.flowId, input.userId, ["PHONE_OTP_REQUIRED"]);
    if (flow.phone_identity_id !== input.phoneIdentityId) throw new Error("phone_identity_mismatch");
    await this.phones.complete(input);
    await this.db.query(
      `UPDATE registration_flows_v3
       SET state='RECOVERY_EMAIL_REQUIRED',updated_at=now() WHERE id=$1`,
      [input.flowId]
    );
    return { state: "RECOVERY_EMAIL_REQUIRED" as const };
  }

  async startRecoveryEmail(input: { flowId: string; userId: string; email: string }) {
    await this.flow(input.flowId, input.userId, ["RECOVERY_EMAIL_REQUIRED"]);
    const result = await this.recoveryEmails.begin(input.userId, input.email);
    await this.db.query(
      `UPDATE registration_flows_v3
       SET state='EMAIL_OTP_REQUIRED',recovery_email_identity_id=$2,updated_at=now()
       WHERE id=$1`,
      [input.flowId, result.identityId]
    );
    return { state: "EMAIL_OTP_REQUIRED" as const, ...result };
  }

  async verifyRecoveryEmail(input: {
    flowId: string;
    userId: string;
    identityId: string;
    challengeId: string;
    code: string;
  }) {
    const flow = await this.flow(input.flowId, input.userId, ["EMAIL_OTP_REQUIRED"]);
    if (flow.recovery_email_identity_id !== input.identityId) throw new Error("recovery_email_identity_mismatch");
    await this.recoveryEmails.verify(input.userId, input.identityId, input.challengeId, input.code);
    await this.db.query(
      `UPDATE registration_flows_v3
       SET state='RECOVERY_EMAIL_VERIFIED',updated_at=now() WHERE id=$1`,
      [input.flowId]
    );
    return { state: "RECOVERY_EMAIL_VERIFIED" as const };
  }

  async activate(input: { flowId: string; userId: string; deviceId?: string }) {
    const flow = await this.flow(input.flowId, input.userId, ["RECOVERY_EMAIL_VERIFIED"]);
    const client = await this.db.connect();
    let accountSlot: number;
    const aliases = {
      identityKeyAlias: `linqa.${input.userId}.identity.${randomBytes(8).toString("hex")}`,
      vaultKeyAlias: `linqa.${input.userId}.vault.${randomBytes(8).toString("hex")}`,
      backupKeyAlias: `linqa.${input.userId}.backup.${randomBytes(8).toString("hex")}`,
      localDbName: `linqa-${input.userId}-${randomBytes(4).toString("hex")}.db`
    };
    try {
      await client.query("BEGIN");
      await client.query(`SELECT id FROM device_installations_v2 WHERE id=$1 FOR UPDATE`, [flow.installation_id]);
      const requirements = await client.query(
        `SELECT
           EXISTS(SELECT 1 FROM phone_identities_v2 WHERE user_id=$1 AND verification_state='VERIFIED_MOBILE') AS phone,
           EXISTS(SELECT 1 FROM recovery_email_identities_v3 WHERE user_id=$1 AND verification_state='VERIFIED') AS email`,
        [input.userId]
      );
      if (!requirements.rows[0]?.phone || !requirements.rows[0]?.email) {
        throw new Error("activation_requirements_not_met");
      }
      const occupied = await client.query(
        `SELECT account_slot FROM installation_accounts_v2
         WHERE installation_id=$1 AND state='ACTIVE' FOR UPDATE`,
        [flow.installation_id]
      );
      const used = new Set(occupied.rows.map((row) => Number(row.account_slot)));
      accountSlot = [1, 2, 3].find((slot) => !used.has(slot)) ?? 0;
      if (!accountSlot) throw new Error("ACCOUNT_LIMIT_REACHED");

      await client.query(
        `INSERT INTO installation_accounts_v2(installation_id,user_id,account_slot,state)
         VALUES($1,$2,$3,'ACTIVE')
         ON CONFLICT(installation_id,user_id) DO UPDATE SET
           account_slot=EXCLUDED.account_slot,state='ACTIVE',removed_at=NULL`,
        [flow.installation_id, input.userId, accountSlot]
      );
      await client.query(
        `INSERT INTO account_crypto_namespaces_v3(
           installation_id,user_id,identity_key_alias,vault_key_alias,backup_key_alias,local_db_name
         ) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(installation_id,user_id) DO NOTHING`,
        [flow.installation_id, input.userId, aliases.identityKeyAlias, aliases.vaultKeyAlias, aliases.backupKeyAlias, aliases.localDbName]
      );
      if (input.deviceId) {
        const device = await client.query(
          `SELECT 1 FROM devices WHERE id=$1 AND user_id=$2 AND status='ACTIVE'`,
          [input.deviceId, input.userId]
        );
        if (device.rowCount !== 1) throw new Error("active_device_required");
        await client.query(
          `INSERT INTO trusted_installation_devices_v3(
             installation_id,user_id,device_id,trust_state,trust_method,trusted_at
           ) VALUES($1,$2,$3,'TRUSTED','VERIFIED_DEVICE',now())
           ON CONFLICT(installation_id,user_id,device_id) DO UPDATE SET
             trust_state='TRUSTED',trust_method='VERIFIED_DEVICE',trusted_at=now(),revoked_at=NULL`,
          [flow.installation_id, input.userId, input.deviceId]
        );
      }
      await client.query(
        `UPDATE registration_flows_v3 SET state='ACCOUNT_ACTIVATED',account_slot=$2,
           completed_at=now(),updated_at=now() WHERE id=$1`,
        [input.flowId, accountSlot]
      );
      await client.query(
        `INSERT INTO identity_security_events_v3(user_id,installation_id,event_type,metadata)
         VALUES($1,$2,'PHONE_FIRST_ACCOUNT_ACTIVATED',$3)`,
        [input.userId, flow.installation_id, { accountSlot, deviceBound: Boolean(input.deviceId) }]
      );
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }

    const session = input.deviceId
      ? await this.sessions.issueForAccount({
          userId: input.userId,
          deviceId: input.deviceId,
          installationId: flow.installation_id
        })
      : null;
    return {
      state: "ACCOUNT_ACTIVATED" as const,
      accountSlot,
      namespace: aliases,
      deviceEnrollmentRequired: !input.deviceId,
      session
    };
  }

  private async flow(id: string, userId: string, allowed: FlowState[]) {
    const result = await this.db.query(
      `SELECT * FROM registration_flows_v3
       WHERE id=$1 AND provisional_user_id=$2 AND expires_at>now()`,
      [id, userId]
    );
    const flow = result.rows[0];
    if (!flow || !allowed.includes(flow.state)) throw new Error("registration_flow_state_invalid");
    return flow;
  }
}
