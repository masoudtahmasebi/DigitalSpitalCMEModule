import { z } from "zod";

/**
 * Environment configuration (P0/P1), validated once at boot.
 *
 * TypeScript types are erased at runtime, so env vars are validated explicitly
 * here rather than trusted (ADR-0001 consequence). A missing or malformed value
 * fails startup loudly instead of surfacing as an undefined deep in a request.
 */
const schema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3000),

  // Migrations run as ds_migrator; the app runs as ds_app, which is not
  // BYPASSRLS and owns nothing (ADR-0002). The app must use DATABASE_URL.
  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  // The API validates every token against these independently — issuer and
  // audience, not just the signature, so a token minted for another client or
  // realm is rejected (ADR-0003).
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_AUDIENCE: z.string().min(1),
  KEYCLOAK_JWKS_URI: z.string().url(),

  // Allowed clock skew when checking exp/nbf, in seconds.
  AUTH_CLOCK_TOLERANCE_SEC: z.coerce.number().int().nonnegative().default(5),

  // JWKS cache TTL in Redis (P1-03).
  JWKS_CACHE_TTL_SEC: z.coerce.number().int().positive().default(3600),

  // Comma-separated origins allowed to call the API. The widget's origin is
  // never the WordPress site's — it is wherever apps/widget is served from —
  // so this must be explicit rather than derived (ADR-0007: the API knows
  // nothing about any specific host).
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    ),

  // Express json body size limit — cheap hygiene against a client sending an
  // unbounded payload. Per-user/IP rate limiting is P10-03, not this.
  MAX_REQUEST_BODY_SIZE: z.string().default("1mb"),

  // ---------------------------------------------------------------------
  // EIV-FOBI submission worker (P7-06)
  // ---------------------------------------------------------------------
  EIV_BASE_URL: z.string().url().default("http://127.0.0.1:4010"),
  // Pointing EIV_BASE_URL at anything non-local additionally requires this to
  // be exactly "yes". The configured VNR belongs to a real accreditation
  // record, and a submission cannot be taken back (ADR-0005).
  EIV_ALLOW_LIVE: z
    .string()
    .default("")
    .transform((value) => value === "yes"),
  EIV_SWEEP_INTERVAL_SEC: z.coerce.number().int().positive().default(60),
  EIV_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(25),
  // Lets a deployment run the API without the worker — useful when scaling
  // web instances horizontally but wanting exactly one submitter.
  EIV_WORKER_ENABLED: z
    .string()
    .default("yes")
    .transform((value) => value !== "no"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return parsed.data;
}

export const CONFIG = Symbol("APP_CONFIG");
