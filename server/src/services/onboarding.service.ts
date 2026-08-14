import type { Database } from "../db/pool.js";

export type OnboardingNextStep =
  | "AUTH_REQUIRED" | "DEVICE_ENROLLMENT" | "RECOVERY_SETUP"
  | "COUNTRY_CONFIRMATION" | "COUNTRY_DISCOVERY" | "SECURITY_REVIEW" | "COMPLETE";

export interface OnboardingStatus {
  phoneVerified: boolean;
  deviceEnrollmentRequired: boolean;
  recoveryReady: boolean;
  recoveryRequired: boolean;
  countryInitialized: boolean;
  countryVerificationState: string;
  discoveryConfigured: boolean;
  blockers: string[];
  nextStep: OnboardingNextStep;
}

export class OnboardingService {
  constructor(private readonly db: Database) {}

  async markNewRegistration(userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO onboarding_state(user_id,registration_required,recovery_required,last_next_step)
       VALUES($1,TRUE,TRUE,'DEVICE_ENROLLMENT')
       ON CONFLICT(user_id) DO UPDATE SET registration_required=TRUE,recovery_required=TRUE,
         completed_at=NULL,updated_at=now()`, [userId]
    );
  }

  async status(userId: string, deviceId?: string): Promise<OnboardingStatus> {
    const result = await this.db.query(
      `SELECT u.status,u.country_verification_state,u.verified_country_code,
         COALESCE(os.recovery_required,FALSE) AS recovery_required,
         EXISTS(SELECT 1 FROM phone_identities_v2 p WHERE p.user_id=u.id AND p.verification_state='VERIFIED_MOBILE') AS phone_verified,
         (EXISTS(SELECT 1 FROM recovery_email_identities_v3 r WHERE r.user_id=u.id AND r.verification_state='VERIFIED')
          OR EXISTS(SELECT 1 FROM account_identifiers ai WHERE ai.user_id=u.id AND ai.type='EMAIL'
            AND ai.is_primary=FALSE AND ai.verified_at IS NOT NULL AND ai.disabled_at IS NULL)) AS recovery_ready,
         EXISTS(SELECT 1 FROM country_discovery_preferences d WHERE d.user_id=u.id) AS discovery_configured,
         CASE WHEN $2::uuid IS NULL THEN FALSE ELSE EXISTS(
           SELECT 1 FROM devices dv WHERE dv.id=$2 AND dv.user_id=u.id AND dv.status='ACTIVE'
         ) END AS device_enrolled
       FROM users u LEFT JOIN onboarding_state os ON os.user_id=u.id WHERE u.id=$1`,
      [userId, deviceId ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error("account_not_found");

    const phoneVerified = Boolean(row.phone_verified);
    const deviceEnrollmentRequired = !Boolean(row.device_enrolled);
    const recoveryReady = Boolean(row.recovery_ready);
    const recoveryRequired = Boolean(row.recovery_required);
    const countryInitialized = Boolean(row.verified_country_code);
    const discoveryConfigured = Boolean(row.discovery_configured);
    const countryVerificationState = String(row.country_verification_state ?? "UNVERIFIED");
    const blockers: string[] = [];
    if (row.status !== "ACTIVE") blockers.push(`ACCOUNT_${row.status}`);
    if (["REVIEW_REQUIRED", "RESTRICTED"].includes(countryVerificationState)) blockers.push(`COUNTRY_${countryVerificationState}`);

    let nextStep: OnboardingNextStep = "COMPLETE";
    if (!phoneVerified) nextStep = "AUTH_REQUIRED";
    else if (deviceEnrollmentRequired) nextStep = "DEVICE_ENROLLMENT";
    else if (recoveryRequired && !recoveryReady) nextStep = "RECOVERY_SETUP";
    else if (!countryInitialized) nextStep = "COUNTRY_CONFIRMATION";
    else if (!discoveryConfigured) nextStep = "COUNTRY_DISCOVERY";
    else if (blockers.length) nextStep = "SECURITY_REVIEW";

    await this.db.query(
      `INSERT INTO onboarding_state(user_id,phone_verified,recovery_ready,country_initialized,
         country_verification_state,discovery_configured,last_next_step,blockers,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7='COMPLETE' THEN now() ELSE NULL END)
       ON CONFLICT(user_id) DO UPDATE SET phone_verified=EXCLUDED.phone_verified,
         recovery_ready=EXCLUDED.recovery_ready,country_initialized=EXCLUDED.country_initialized,
         country_verification_state=EXCLUDED.country_verification_state,
         discovery_configured=EXCLUDED.discovery_configured,last_next_step=EXCLUDED.last_next_step,
         blockers=EXCLUDED.blockers,completed_at=EXCLUDED.completed_at,updated_at=now()`,
      [userId, phoneVerified, recoveryReady, countryInitialized, countryVerificationState,
        discoveryConfigured, nextStep, JSON.stringify(blockers)]
    );
    return { phoneVerified, deviceEnrollmentRequired, recoveryReady, recoveryRequired,
      countryInitialized, countryVerificationState, discoveryConfigured, blockers, nextStep };
  }
}
