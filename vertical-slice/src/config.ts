import { z } from "zod";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_ISSUER: z.string().url(),
  JWT_AUDIENCE: z.string().min(1),
  JWT_HS256_SECRET: z.string().min(32),
  MAX_ENVELOPE_BYTES: z.coerce.number().int().min(1024).max(1048576).default(262144),
  ENVELOPE_TTL_SECONDS: z.coerce.number().int().min(3600).max(7776000).default(2592000),
  DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  LOG_LEVEL: z.enum(["fatal","error","warn","info","debug","trace"]).default("info")
});

export type AppConfig = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = Schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  return result.data;
}
