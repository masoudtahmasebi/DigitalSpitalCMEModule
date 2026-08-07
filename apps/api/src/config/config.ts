import { z } from "zod";

/**
 * Environment configuration (P0/P1), validated once at boot.
 *
 * TypeScript types are erased at runtime, so env vars are validated explicitly
 * here rather than trusted (ADR-0001 consequence). A missing or malformed value
 * fails startup loudly instead of surfacing as an undefined deep in a request.
 */
const schema = z
  .object({
    API_PORT: z.coerce.number().int().positive().default(3000),

    // Migrations run as ds_migrator; the app runs as ds_app, which is not
    // BYPASSRLS and owns nothing (ADR-0002). The app must use DATABASE_URL.
    DATABASE_URL: z.string().url(),

    REDIS_URL: z.string().url(),

    /*
     * There is deliberately no KEYCLOAK_ISSUER here (P17-02).
     *
     * The API validates every token against an issuer and an audience, not just
     * a signature (ADR-0003) — but *which* issuer is a property of the project
     * the request names, not of the deployment. It is read from
     * `projects.keycloak_issuer` by `ProjectBindingRepository` and handed to
     * the guard per request, which is what lets one installation serve several
     * customers with separate realms.
     *
     * Three variables — `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE`,
     * `KEYCLOAK_JWKS_URI` — used to be declared here and validated at boot.
     * Nothing read any of them. They were a deployment-wide answer to a
     * per-tenant question, and their only effect was to make a deployment
     * name one customer's realm in a file that is not about any customer.
     */

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
      )
      // A wildcard is refused at boot rather than silently misbehaving. `cors`
      // treats an array containing "*" as a literal origin to match, so it would
      // in fact deny everything — which is safe but reads as "CORS is broken" and
      // invites somebody to reach for a configuration that genuinely is open. An
      // API that returns a physician's participation record has no origin it can
      // afford to allow blindly.
      .refine(
        (origins) => !origins.includes("*"),
        "ALLOWED_ORIGINS may not contain '*' — list every origin explicitly",
      ),

    // Express json body size limit — cheap hygiene against a client sending an
    // unbounded payload. Per-user/IP rate limiting is P10-03, not this.
    MAX_REQUEST_BODY_SIZE: z.string().default("1mb"),

    /**
     * The limit for `PUT /admin/branding/font` alone (P10-08).
     *
     * The column allows a 2 MB font and base64 inflates that to about 2.8 MB, so
     * the global 1 MB limit would refuse a legitimate upload with an opaque 413
     * — before the validation that produces a readable German error ever ran.
     * Scoped to one route in `main.ts`: the reason there is a body limit at all
     * is that a JSON parser is a denial-of-service surface, and raising it
     * everywhere to accommodate one endpoint gives that up.
     */
    MAX_FONT_BODY_SIZE: z.string().default("3mb"),

    /**
     * Where a Punktemeldung deadline alarm is posted (P10-06).
     *
     * Optional, and the alarm works without it: every alert is logged at `error`
     * regardless, so log-based alerting is the floor. A webhook is what turns
     * that into something that reaches a person on a Saturday.
     *
     * Generic JSON, so Slack, Teams, PagerDuty or an internal endpoint all work
     * without a code change. Empty means "log only".
     */
    ALERT_WEBHOOK_URL: z.union([z.literal(""), z.string().url()]).default(""),

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

    // Certificate delivery (P8-03). Slower than the EIV sweep on purpose: a
    // Punktemeldung races an 8-day statutory window, a certificate has no
    // deadline and its retry policy backs off over about a day. Sweeping every
    // minute would mean 1,440 claims a day to find six rows still waiting.
    CERTIFICATE_DELIVERY_INTERVAL_SEC: z.coerce.number().int().positive().default(300),
    CERTIFICATE_DELIVERY_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .max(500)
      .default(25),
    // As with the EIV worker: lets a deployment scale web instances while
    // running exactly one sender.
    CERTIFICATE_DELIVERY_ENABLED: z
      .string()
      .default("yes")
      .transform((value) => value !== "no"),
    // Where the download link in the certificate email points. The portal, not
    // the API: the link is for a person to click, and it has to land on a page
    // that can sign them in.
    PORTAL_BASE_URL: z.string().default(""),

    // ---------------------------------------------------------------------
    // Object storage for course media (P10-09)
    // ---------------------------------------------------------------------
    // Optional as a group: a deployment whose courses use plain CDN URLs needs
    // none of it. Configure all of it or none — `S3Presigner` refuses to build
    // from a partial set rather than minting URLs that 403 mid-video.
    //
    // S3-*compatible*, not Amazon: hosting is Hetzner in Germany on purpose, and
    // German physicians' course media in a US-controlled bucket is a transfer
    // question nobody wants to answer.
    S3_ENDPOINT: z.string().default(""),
    S3_REGION: z.string().default(""),
    S3_BUCKET: z.string().default(""),
    S3_ACCESS_KEY_ID: z.string().default(""),
    S3_SECRET_ACCESS_KEY: z.string().default(""),
    // Path-style by default: MinIO wants it, every S3-compatible store accepts
    // it, and it makes no assumptions about DNS or certificates for a bucket
    // name.
    S3_FORCE_PATH_STYLE: z
      .string()
      .default("yes")
      .transform((value) => value !== "no"),
    // How long a media URL stays usable. Short, because a presigned URL is a
    // capability: one in a browser history or a proxy log keeps working until it
    // expires. Long enough that a learner can finish a 25-minute video without
    // the URL dying mid-playback.
    S3_URL_TTL_SEC: z.coerce.number().int().positive().max(86_400).default(3_600),
    // How long an upload signature stays usable (P23-01). Bounds when the PUT
    // may *start*, not how long it may take — S3 checks the expiry as the
    // request arrives, so a 700 MB body that began in time keeps going. Thirty
    // minutes covers a file picker left open while somebody finds the right
    // version; it is not a window in which to hunt for a bigger file.
    S3_UPLOAD_TTL_SEC: z.coerce.number().int().positive().max(3_600).default(1_800),

    // ---------------------------------------------------------------------
    // Encryption at rest for stored secrets (CLAUDE.md §4 invariant 7)
    // ---------------------------------------------------------------------
    // 32 bytes, base64-encoded. Protects the VNR password and the SMTP
    // credentials in their `_enc` columns — see shared/secret-cipher.ts.
    //
    //   openssl rand -base64 32
    //
    // Optional here and required below, because "required in production only"
    // is not something a single field can express. Development and test may run
    // without it on the plaintext cipher; production may not, and the check
    // after this object turns that into a refusal to start.
    SECRETS_KMS_KEY: z.string().default(""),

    // The parent domain the staff session cookie is scoped to — ".cme.example.de",
    // so the console at verwaltung.… and the API at api.… are same-site and the
    // browser attaches it (ADR-0012). Empty in development, where both are on
    // localhost and a Domain attribute would stop the cookie being stored at all.
    STAFF_COOKIE_DOMAIN: z.string().default(""),

    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  })
  // Boot-time, not first-use. The schedulers build a cipher during startup, so
  // without this the failure is a stack trace from a background worker rather
  // than a configuration error naming the variable — and a deployment that
  // fails to start is far easier to diagnose than one that starts and then
  // cannot send a Punktemeldung.
  .refine(
    (config) =>
      config.NODE_ENV !== "production" ||
      Buffer.from(config.SECRETS_KMS_KEY, "base64").length === 32,
    {
      path: ["SECRETS_KMS_KEY"],
      message:
        "is required in production and must decode to 32 bytes " +
        "(generate with: openssl rand -base64 32)",
    },
  );

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
