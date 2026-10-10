import type { Database } from "../db/pool.js";

export type OnboardingNextStep =
  | "AUTH_REQUIRED" | "DEVICE_ENROLLMENT" | "PROFILE_SETUP" | "RECOVERY_SETUP"
  | "COUNTRY_CONFIRMATION" | "COUNTRY_DISCOVERY" | "SECURITY_REVIEW" | "COMPLETION" | "COMPLETE";

export interface OnboardingStatus {
  profileReady: boolean;
  phoneVerified: boolean;
  deviceEnrollmentRequired: boolean;
  recoveryReady: boolean;
  recoveryRequired: boolean;
  countryInitialized: boolean;
  countryVerificationState: string;
  discoveryConfigured: boolean;
  blockers: string[];
  detectedCountry: { code: string; name: string; callingCode: string | null } | null;
  onboardingCompletedAt: string | null;
  completionScreenSeen: boolean;
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
         COALESCE(os.registration_required,FALSE) AS registration_required,
         COALESCE(os.recovery_required,FALSE) AS recovery_required,
         os.completed_at,os.completion_screen_seen_at,
         EXISTS(SELECT 1 FROM user_profiles p WHERE p.user_id=u.id
           AND length(btrim(p.full_name))>0 AND length(btrim(p.stage_name))>0) AS profile_ready,
         EXISTS(SELECT 1 FROM phone_identities_v2 p WHERE p.user_id=u.id AND p.verification_state='VERIFIED_MOBILE') AS phone_verified,
         (EXISTS(SELECT 1 FROM recovery_email_identities_v3 r WHERE r.user_id=u.id AND r.verification_state='VERIFIED')
          OR EXISTS(SELECT 1 FROM account_identifiers ai WHERE ai.user_id=u.id AND ai.type='EMAIL'
            AND ai.is_primary=FALSE AND ai.verified_at IS NOT NULL AND ai.disabled_at IS NULL)) AS recovery_ready,
         EXISTS(SELECT 1 FROM country_discovery_preferences d WHERE d.user_id=u.id) AS discovery_configured,
         (SELECT p.country_iso2 FROM phone_identities_v2 p WHERE p.user_id=u.id AND p.verification_state='VERIFIED_MOBILE') AS detected_country_code,
         (SELECT c.name FROM phone_identities_v2 p JOIN countries c ON c.code=p.country_iso2 WHERE p.user_id=u.id AND p.verification_state='VERIFIED_MOBILE') AS detected_country_name,
         (SELECT c.calling_code FROM phone_identities_v2 p JOIN countries c ON c.code=p.country_iso2 WHERE p.user_id=u.id AND p.verification_state='VERIFIED_MOBILE') AS detected_calling_code,
         CASE WHEN $2::uuid IS NULL THEN FALSE ELSE EXISTS(
           SELECT 1 FROM devices dv WHERE dv.id=$2 AND dv.user_id=u.id AND dv.status='ACTIVE'
         ) END AS device_enrolled
       FROM users u LEFT JOIN onboarding_state os ON os.user_id=u.id WHERE u.id=$1`,
      [userId, deviceId ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error("account_not_found");

    const profileReady = !Boolean(row.registration_required) || Boolean(row.profile_ready);
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

    const technicallyComplete = profileReady && phoneVerified && !deviceEnrollmentRequired && (!recoveryRequired || recoveryReady)
      && countryInitialized && discoveryConfigured && blockers.length === 0;
    const completionScreenSeen = Boolean(row.completion_screen_seen_at);
    let nextStep: OnboardingNextStep = "COMPLETE";
    if (!phoneVerified) nextStep = "AUTH_REQUIRED";
    else if (deviceEnrollmentRequired) nextStep = "DEVICE_ENROLLMENT";
    else if (!profileReady) nextStep = "PROFILE_SETUP";
    else if (recoveryRequired && !recoveryReady) nextStep = "RECOVERY_SETUP";
    else if (!countryInitialized) nextStep = "COUNTRY_CONFIRMATION";
    else if (!discoveryConfigured) nextStep = "COUNTRY_DISCOVERY";
    else if (blockers.length) nextStep = "SECURITY_REVIEW";
    else if (Boolean(row.registration_required) && !completionScreenSeen) nextStep = "COMPLETION";

    await this.db.query(
      `INSERT INTO onboarding_state(user_id,phone_verified,recovery_ready,country_initialized,
         country_verification_state,discovery_configured,last_next_step,blockers,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN now() ELSE NULL END)
       ON CONFLICT(user_id) DO UPDATE SET phone_verified=EXCLUDED.phone_verified,
         recovery_ready=EXCLUDED.recovery_ready,country_initialized=EXCLUDED.country_initialized,
         country_verification_state=EXCLUDED.country_verification_state,
         discovery_configured=EXCLUDED.discovery_configured,last_next_step=EXCLUDED.last_next_step,
         blockers=EXCLUDED.blockers,
         completed_at=CASE WHEN $9 THEN COALESCE(onboarding_state.completed_at,now()) ELSE NULL END,
         updated_at=now()`,
      [userId, phoneVerified, recoveryReady, countryInitialized, countryVerificationState,
        discoveryConfigured, nextStep, JSON.stringify(blockers), technicallyComplete]
    );
    const detectedCountry = row.detected_country_code ? {
      code: String(row.detected_country_code), name: String(row.detected_country_name ?? row.detected_country_code),
      callingCode: row.detected_calling_code ? String(row.detected_calling_code) : null
    } : null;
    return { profileReady, phoneVerified, deviceEnrollmentRequired, recoveryReady, recoveryRequired,
      countryInitialized, countryVerificationState, discoveryConfigured, blockers, detectedCountry,
      onboardingCompletedAt: technicallyComplete ? (row.completed_at ? new Date(row.completed_at).toISOString() : new Date().toISOString()) : null,
      completionScreenSeen, nextStep };
  }

  async profile(userId: string) {
    const result = await this.db.query(
      `SELECT full_name AS "fullName",stage_name AS "stageName" FROM user_profiles WHERE user_id=$1`, [userId]
    );
    return { fullName: result.rows[0]?.fullName ?? "", stageName: result.rows[0]?.stageName ?? "" };
  }

  async saveProfile(userId: string, deviceId: string | undefined, fullName: string, stageName: string) {
    const current = await this.status(userId, deviceId);
    if (!current.phoneVerified || current.deviceEnrollmentRequired || current.blockers.length) {
      throw new Error("profile_setup_not_allowed");
    }
    await this.db.query(
      `INSERT INTO user_profiles(user_id,display_name,full_name,stage_name) VALUES($1,$3,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.stage_name,
         full_name=EXCLUDED.full_name,stage_name=EXCLUDED.stage_name,updated_at=now()`,
      [userId, fullName, stageName]
    );
    return { saved: true };
  }

  async acknowledgeCompletion(userId: string, deviceId?: string) {
    const current = await this.status(userId, deviceId);
    if (current.nextStep !== "COMPLETION" && current.nextStep !== "COMPLETE") {
      throw new Error("onboarding_not_complete");
    }
    const result = await this.db.query(
      `UPDATE onboarding_state SET completion_screen_seen_at=COALESCE(completion_screen_seen_at,now()),
         last_next_step='COMPLETE',updated_at=now() WHERE user_id=$1
       RETURNING completion_screen_seen_at`, [userId]
    );
    return { completionScreenSeen: true, completionScreenSeenAt: result.rows[0].completion_screen_seen_at };
  }
}
