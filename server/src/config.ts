import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().min(1),
  JWT_HS256_SECRET: z.string().min(32),
  JWT_JWKS_URL: z.string().url().optional(),
  JWT_SIGNING_PRIVATE_KEY_PEM: z.string().min(40).optional(),
  JWT_VERIFYING_PUBLIC_KEY_PEM: z.string().min(40).optional(),
  CONTACT_DISCOVERY_SECRET: z.string().min(32),
  IP_HASH_SECRET: z.string().min(32).optional(),
  TOKEN_VAULT_KEY_BASE64: z.string().min(44),
  TURN_SHARED_SECRET: z.string().min(32),
  TURN_URLS: z.string()
    .default("turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  CORS_ORIGINS: z.string()
    .default("http://127.0.0.1:5173")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
  DEVICE_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  ENVELOPE_TTL_SECONDS: z.coerce.number().int().min(3600).max(7_776_000).default(2_592_000),
  MAX_ENVELOPE_BYTES: z.coerce.number().int().min(1024).max(1_048_576).default(262_144),
  DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  OBJECT_STORAGE_REGION: z.string().min(1).optional(),
  OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
  OBJECT_STORAGE_KMS_KEY_ID: z.string().min(1).optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().url().optional(),
  OBJECT_STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().optional(),
  PASSKEY_RP_ID: z.string().min(1).default("linqa.local"),
  PASSKEY_RP_NAME: z.string().min(1).default("Linqa"),
  PASSKEY_ORIGINS: z.string()
    .default("http://127.0.0.1:5173")
    .transform((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),

  // Real-when-configured providers (2026-08-07, restored 2026-08-08 after a
  // concurrent-edit collision with a separate agent's CountryLinqa work
  // wiped this whole block out of config.ts — see claudeassess.txt /
  // conversation history for the incident. Re-merged here alongside
  // CountryLinqa's own fields below rather than replacing them again).
  // Each group follows the same all-or-nothing pattern as OBJECT_STORAGE_*
  // above; service-container.ts selects the real implementation only when
  // every field in a group is present, falling back to the existing
  // FailClosed*/Dev* stub otherwise.
  APNS_TEAM_ID: z.string().min(1).optional(),
  APNS_KEY_ID: z.string().min(1).optional(),
  APNS_PRIVATE_KEY_P8: z.string().min(1).optional(),
  APNS_BUNDLE_ID: z.string().min(1).optional(),
  APNS_SANDBOX: z.coerce.boolean().default(false),

  FCM_PROJECT_ID: z.string().min(1).optional(),
  FCM_CLIENT_EMAIL: z.string().min(1).optional(),
  FCM_PRIVATE_KEY: z.string().min(1).optional(),

  CDN_STORAGE_BUCKET: z.string().min(1).optional(),
  CDN_STORAGE_REGION: z.string().min(1).optional(),

  BILLING_WEBHOOK_SECRET: z.string().min(16).optional(),
  BILLING_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(300),

  LINQASEND_WEBHOOK_SECRET: z.string().min(16).optional(),
  LINQASEND_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(60).max(86_400).default(300),
  LINQASEND_PROVIDER_URL: z.string().url().optional(),
  LINQASEND_PROVIDER_TOKEN: z.string().min(16).optional(),

  ESCALATION_STAFF_WEBHOOK_URL: z.string().url().optional(),
  ESCALATION_STAFF_WEBHOOK_SECRET: z.string().min(16).optional(),

  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_FROM_NUMBER: z.string().min(1).optional(),
  TWILIO_VOICE_FROM_NUMBER: z.string().min(1).optional(),

  TWILIO_LOOKUP_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_LOOKUP_AUTH_TOKEN: z.string().min(1).optional(),

  EMAIL_DELIVERY_URL: z.string().url().optional(),
  EMAIL_DELIVERY_HEALTH_URL: z.string().url().optional(),
  EMAIL_DELIVERY_TOKEN: z.string().min(16).optional(),
  EMAIL_FROM: z.string().email().optional(),

  ARCHIVE_STORAGE_BUCKET: z.string().min(1).optional(),
  ARCHIVE_STORAGE_REGION: z.string().min(1).optional(),
  ARCHIVE_STORAGE_KMS_KEY_ID: z.string().min(1).optional(),

  // CountryLinqa (added by a separate agent session, 2026-08-08) — kept
  // as-is; not part of the provider block above.
  COUNTRY_SELECTION_PREMIUM_LIMIT: z.coerce.number().int().min(1).default(20),
  COUNTRYLINQA_DATA_KEY_V1: z.string().length(64).optional(),
  SECURE_CORE_ARTIFACT_SHA256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  SECURE_CORE_ARTIFACT_PATH: z.string().min(1).optional(),
  COUNTRYLINQA_RISK_URL: z.string().url().optional(),
  COUNTRYLINQA_GEOIP_URL: z.string().url().optional(),
  COUNTRYLINQA_GEOIP_TOKEN: z.string().min(16).optional(),
  PRODUCTION_RELEASE_ID: z.string().trim().min(1).max(128).optional(),
  STEP_UP_PRIVATE_KEY_PEM: z.string().min(40).optional(),
  STEP_UP_PUBLIC_KEY_PEM: z.string().min(40).optional(),
  TRANSPARENCY_PRIVATE_KEY_PEM: z.string().min(40).optional(),
  TRANSPARENCY_PUBLIC_KEY_BASE64: z.string().min(40).optional(),
  REDIS_URL: z.string().url().optional(),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info")
}).superRefine((value, context) => {
  const requireAllOrNone = (fields: Array<[string, unknown]>) => {
    const present = fields.filter(([, v]) => v !== undefined && v !== "").length;
    if (present !== 0 && present !== fields.length) {
      context.addIssue({
        code: "custom",
        message: `${fields.map(([k]) => k).join(", ")} must all be set together or all omitted`
      });
    }
  };

  requireAllOrNone([
    ["JWT_SIGNING_PRIVATE_KEY_PEM", value.JWT_SIGNING_PRIVATE_KEY_PEM],
    ["JWT_VERIFYING_PUBLIC_KEY_PEM", value.JWT_VERIFYING_PUBLIC_KEY_PEM]
  ]);

  if (value.NODE_ENV === "production" &&
      (!value.JWT_SIGNING_PRIVATE_KEY_PEM || !value.JWT_VERIFYING_PUBLIC_KEY_PEM)) {
    context.addIssue({
      code: "custom",
      message: "production requires JWT_SIGNING_PRIVATE_KEY_PEM and JWT_VERIFYING_PUBLIC_KEY_PEM for first-party sessions"
    });
  }

  if (value.NODE_ENV === "production" && !value.IP_HASH_SECRET) {
    context.addIssue({ code: "custom", message: "production requires a dedicated IP_HASH_SECRET" });
  }

  requireAllOrNone([
    ["OBJECT_STORAGE_REGION", value.OBJECT_STORAGE_REGION],
    ["OBJECT_STORAGE_BUCKET", value.OBJECT_STORAGE_BUCKET],
    ["OBJECT_STORAGE_KMS_KEY_ID", value.OBJECT_STORAGE_KMS_KEY_ID]
  ]);

  requireAllOrNone([
    ["APNS_TEAM_ID", value.APNS_TEAM_ID],
    ["APNS_KEY_ID", value.APNS_KEY_ID],
    ["APNS_PRIVATE_KEY_P8", value.APNS_PRIVATE_KEY_P8],
    ["APNS_BUNDLE_ID", value.APNS_BUNDLE_ID]
  ]);

  requireAllOrNone([
    ["FCM_PROJECT_ID", value.FCM_PROJECT_ID],
    ["FCM_CLIENT_EMAIL", value.FCM_CLIENT_EMAIL],
    ["FCM_PRIVATE_KEY", value.FCM_PRIVATE_KEY]
  ]);

  requireAllOrNone([
    ["CDN_STORAGE_BUCKET", value.CDN_STORAGE_BUCKET],
    ["CDN_STORAGE_REGION", value.CDN_STORAGE_REGION]
  ]);

  requireAllOrNone([
    ["LINQASEND_PROVIDER_URL", value.LINQASEND_PROVIDER_URL],
    ["LINQASEND_PROVIDER_TOKEN", value.LINQASEND_PROVIDER_TOKEN]
  ]);

  requireAllOrNone([
    ["ESCALATION_STAFF_WEBHOOK_URL", value.ESCALATION_STAFF_WEBHOOK_URL],
    ["ESCALATION_STAFF_WEBHOOK_SECRET", value.ESCALATION_STAFF_WEBHOOK_SECRET]
  ]);

  requireAllOrNone([
    ["TWILIO_ACCOUNT_SID", value.TWILIO_ACCOUNT_SID],
    ["TWILIO_AUTH_TOKEN", value.TWILIO_AUTH_TOKEN],
    ["TWILIO_FROM_NUMBER", value.TWILIO_FROM_NUMBER]
  ]);

  requireAllOrNone([
    ["TWILIO_LOOKUP_ACCOUNT_SID", value.TWILIO_LOOKUP_ACCOUNT_SID],
    ["TWILIO_LOOKUP_AUTH_TOKEN", value.TWILIO_LOOKUP_AUTH_TOKEN]
  ]);

  requireAllOrNone([
    ["EMAIL_DELIVERY_URL", value.EMAIL_DELIVERY_URL],
    ["EMAIL_DELIVERY_HEALTH_URL", value.EMAIL_DELIVERY_HEALTH_URL],
    ["EMAIL_DELIVERY_TOKEN", value.EMAIL_DELIVERY_TOKEN],
    ["EMAIL_FROM", value.EMAIL_FROM]
  ]);

  requireAllOrNone([
    ["ARCHIVE_STORAGE_BUCKET", value.ARCHIVE_STORAGE_BUCKET],
    ["ARCHIVE_STORAGE_REGION", value.ARCHIVE_STORAGE_REGION],
    ["ARCHIVE_STORAGE_KMS_KEY_ID", value.ARCHIVE_STORAGE_KMS_KEY_ID]
  ]);

  requireAllOrNone([
    ["STEP_UP_PRIVATE_KEY_PEM", value.STEP_UP_PRIVATE_KEY_PEM],
    ["STEP_UP_PUBLIC_KEY_PEM", value.STEP_UP_PUBLIC_KEY_PEM]
  ]);

  requireAllOrNone([
    ["TRANSPARENCY_PRIVATE_KEY_PEM", value.TRANSPARENCY_PRIVATE_KEY_PEM],
    ["TRANSPARENCY_PUBLIC_KEY_BASE64", value.TRANSPARENCY_PUBLIC_KEY_BASE64]
  ]);

  requireAllOrNone([
    ["SECURE_CORE_ARTIFACT_SHA256", value.SECURE_CORE_ARTIFACT_SHA256],
    ["SECURE_CORE_ARTIFACT_PATH", value.SECURE_CORE_ARTIFACT_PATH]
  ]);
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid server configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}
