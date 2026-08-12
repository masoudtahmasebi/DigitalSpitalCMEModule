/**
 * Drizzle schema — the single mapping point between snake_case database
 * identifiers and camelCase TypeScript (CLAUDE.md §5).
 *
 * `db/migrations/0001_init.sql` is authoritative; this file mirrors it and a
 * test (P0-04) asserts the two agree. Nothing here creates or alters tables —
 * migrations do that, run as ds_migrator. This is only the typed view the
 * application (ds_app) reads and writes through, under RLS.
 */

import {
  bigint,
  customType,
  bigserial,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const courseDeliveryType = pgEnum("course_delivery_type", [
  "on_demand",
  "live",
  "praesenz",
]);
/** Editorial state (P53-01). A draft is invisible to learners. */
export const courseStatus = pgEnum("course_status", ["draft", "published"]);
export const contentKind = pgEnum("content_kind", [
  "video",
  "text",
  "quiz",
  "details",
  "material",
]);
export const appRole = pgEnum("app_role", [
  "super_admin",
  "customer_admin",
  "department_admin",
  "learner",
]);
export const progressStatus = pgEnum("progress_status", [
  "not_started",
  "in_progress",
  "completed",
]);
export const questionKind = pgEnum("question_kind", ["single", "multi"]);
export const eivStatus = pgEnum("eiv_status", [
  "queued",
  "held",
  "submitted",
  "failed_retryable",
  "failed_permanent",
  "window_closed",
  /** Reported, then withdrawn by an operator at the authority (P31-02). */
  "withdrawn",
]);
export const certificateStatus = pgEnum("certificate_status", [
  "pending",
  "issued",
  "delivered",
  "bounced",
]);

/**
 * `bytea`, mapped to Buffer.
 *
 * Drizzle has no built-in bytea, and declaring these columns `text` — as this
 * schema originally did — silently hands callers a Buffer typed as a string.
 * That is not a type-safety nicety: it shipped the VNR password to the EIV
 * client as `{"type":"Buffer","data":[...]}`, which authenticates as nobody.
 * Caught by the worker's integration test against the mock.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps,
});

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  ...timestamps,
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  departmentId: uuid("department_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  /**
   * How this project's learners authenticate (ADR-0012): `keycloak` or `local`.
   *
   * `local` is the standalone portal's. It was in the schema and settable by no
   * API, so a project created through the console was always Keycloak-bound and
   * its participants could not sign in at all (found by the journey suite).
   */
  identityProvider: text("identity_provider").notNull(),
  /**
   * The customer's own sign-in page (migration 0028).
   *
   * Absent from this schema until P29-03, which is *why* nothing could write
   * it: Drizzle only knows the columns declared here, so the column existed in
   * PostgreSQL, was read by `resolve_project_signin`, was branched on by the
   * portal — and was invisible to every query this application builds.
   */
  loginUrl: text("login_url"),
  keycloakIssuer: text("keycloak_issuer"),
  keycloakAudience: text("keycloak_audience"),
  keycloakRealm: text("keycloak_realm"),
  /**
   * Origins allowed to embed this project's widget (P18-04). Used to be
   * `EXTRA_CORS_ORIGINS` in an env file, shared across every customer.
   */
  embedOrigins: text("embed_origins").array().notNull().default([]),
  branding: jsonb("branding").notNull().default({}),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUsername: text("smtp_username"),
  // Write-only ciphertext, read only through SecretCipher. Never selected
  // into a response (CLAUDE.md §4 invariant 7).
  smtpPasswordEnc: bytea("smtp_password_enc"),
  smtpFromAddress: text("smtp_from_address"),
  smtpFromName: text("smtp_from_name"),
  // The customer's own webfont (migration 0008). Stored rather than linked so
  // that no learner's browser ever contacts a font CDN — see the migration for
  // why that is a legal position and not a preference. All four columns are
  // set together or all null; the table has a CHECK saying so.
  fontFile: bytea("font_file"),
  fontMime: text("font_mime"),
  fontFamilyName: text("font_family_name"),
  fontUpdatedAt: timestamp("font_updated_at", { withTimezone: true }),
  ...timestamps,
});

export const courses = pgTable("courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  projectId: uuid("project_id").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  heroImageUrl: text("hero_image_url"),
  learningObjectives: text("learning_objectives").array().notNull().default([]),
  targetAudience: text("target_audience"),
  /** The "Vorkenntnisse" paragraph under Zielgruppe (layout page 02). */
  prerequisites: text("prerequisites"),
  deliveryType: courseDeliveryType("delivery_type").notNull().default("on_demand"),
  thema: text("thema").array().notNull().default([]),
  altersgruppe: text("altersgruppe").array().notNull().default([]),
  vnr: text("vnr"),
  // Ciphertext. Read only through SecretCipher; never selected into a response.
  vnrPasswordEnc: bytea("vnr_password_enc"),
  /*
   * Which credit a Punktemeldung claims for this course (P31-02, S25).
   *
   * A course setting rather than a constant because the Ärztekammer accredits
   * each event for its own point values, and `GET /veranstaltung` reports them
   * per VNR. Drizzle only knows columns declared here — a column absent from
   * this file is invisible to every query, which is how `login_url` came to be
   * writable nowhere (P28-02).
   */
  eivPunkteBasis: boolean("eiv_punkte_basis").notNull().default(true),
  eivPunkteLernerfolg: boolean("eiv_punkte_lernerfolg").notNull().default(true),
  fortbildungsnummer: text("fortbildungsnummer"),
  accreditationBody: text("accreditation_body"),
  cmePoints: integer("cme_points"),
  cmeCategory: text("cme_category"),
  eventLocation: text("event_location"),
  organizer: text("organizer"),
  /**
   * Editorial state (P53-01, migration 0038).
   *
   * `draft` by default: a course created in the console is invisible to
   * learners until somebody publishes it. Separate from the validity window
   * below, which says *when an accredited course runs* rather than whether it
   * is finished being written.
   */
  status: courseStatus("status").notNull().default("draft"),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  requiredWatchPercent: integer("required_watch_percent").notNull().default(100),
  passThresholdPercent: integer("pass_threshold_percent").notNull().default(70),
  maxQuizAttempts: integer("max_quiz_attempts"),
  revealCorrectAnswers: boolean("reveal_correct_answers").notNull().default(false),

  // Certificate signing assets (P8). Supplied per course by whoever creates it:
  // the Bescheid requires the stamp and signature of that course's
  // Wissenschaftliche Leitung. Images are bytes, not URLs — see migration 0006.
  scientificLeadName: text("scientific_lead_name"),
  scientificLeadTitle: text("scientific_lead_title"),
  stampImage: bytea("stamp_image"),
  stampImageMime: text("stamp_image_mime"),
  signatureImage: bytea("signature_image"),
  signatureImageMime: text("signature_image_mime"),
  certificateIssuePlace: text("certificate_issue_place"),

  ...timestamps,
});

export const modules = pgTable("modules", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  courseId: uuid("course_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  ...timestamps,
});

export const chapters = pgTable("chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  moduleId: uuid("module_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  ...timestamps,
});

export const contents = pgTable("contents", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  chapterId: uuid("chapter_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: contentKind("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  /**
   * Ordered playable renditions (migration 0016). Adaptive streams first — a
   * browser takes the first `type` it can play, which is the whole of the
   * platform's format negotiation. Shape is validated by `parseMediaSources`
   * on read, because `jsonb` guarantees nothing.
   */
  mediaSources: jsonb("media_sources").notNull().default([]),
  /** Still frame shown before playback. NULL renders a blank first frame. */
  posterUrl: text("poster_url"),
  /** WebVTT captions (WCAG 1.2.2 Level A). NULL means none authored. */
  captionsUrl: text("captions_url"),
  durationSec: integer("duration_sec"),
  fileUrl: text("file_url"),
  fileSize: bigint("file_size", { mode: "number" }),
  mimeType: text("mime_type"),
  ...timestamps,
});

export const courseExperts = pgTable("course_experts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  courseId: uuid("course_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  roleLabel: text("role_label").notNull(),
  name: text("name").notNull(),
  institution: text("institution"),
  biography: text("biography"),
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The person. Deliberately global — not tenant-scoped — because a physician's
 * EFN, certificates and name belong to them across every customer they learn
 * with (migration 0001, and P21-01 for why that survived the identity split).
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  /**
   * When this subject was erased (migration 0009). Read-only from the API's
   * point of view: a database trigger blanks the profile columns on every
   * update once this is set, so a later sign-in cannot write the name back.
   */
  erasedAt: timestamp("erased_at", { withTimezone: true }),
  ...timestamps,
});

/**
 * A way to sign in as a person (P21-01). Global for the same reason `users` is,
 * and for one more: the auth guard resolves a credential *before* a tenant
 * context exists, so a tenant-scoped policy here would fail closed on every
 * request.
 *
 * Two credentials are linked to one person only by an explicit, verified act
 * (P21-05) — never automatically because two providers reported the same email,
 * which is account takeover against any provider that does not verify.
 */
export const userIdentities = pgTable("user_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  realm: text("realm").notNull(),
  subject: text("subject").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Which customers a person learns with (P21-01). Tenant-scoped, unlike the
 * person themselves — this is the row a customer admin may see.
 *
 * Derived, not declared: an enrolment in a customer's course *is* a membership,
 * and `createEnrolment` keeps that true so the table cannot drift from the fact
 * it records.
 */
export const userCustomers = pgTable("user_customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  customerId: uuid("customer_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const efnProfiles = pgTable("efn_profiles", {
  userId: uuid("user_id").primaryKey(),
  efn: text("efn").notNull(),
  ...timestamps,
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  role: appRole("role").notNull(),
  customerId: uuid("customer_id"),
  departmentId: uuid("department_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const enrolments = pgTable("enrolments", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  courseId: uuid("course_id").notNull(),
  userId: uuid("user_id").notNull(),
  requiredWatchPercent: integer("required_watch_percent").notNull(),
  passThresholdPercent: integer("pass_threshold_percent").notNull(),
  maxQuizAttempts: integer("max_quiz_attempts"),
  cmePoints: integer("cme_points"),
  cmeCategory: text("cme_category"),
  vnr: text("vnr"),
  lastContentId: uuid("last_content_id"),
  /**
   * Certified: watched, passed, evaluated, EFN on file, Punktemeldung queued.
   * The moment a CME point is claimed on the physician's behalf.
   */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /**
   * The Fortbildung itself finished — videos watched, Lernerfolgskontrolle
   * passed (P51-01, migration 0037). Always earlier than or equal to
   * `completedAt`, which additionally waits for the evaluation and the EFN.
   *
   * NULL on rows certified before the column existed; see the migration for
   * why those are not backfilled.
   */
  courseCompletedAt: timestamp("course_completed_at", { withTimezone: true }),
  /**
   * The one name that is reported and printed.
   *
   * Composed from the three parts below by `composeAttestedName` in
   * `@ds/domain` — see the note there for why there is exactly one composer.
   * Rows written before migration 0024 carry a free-text name with no parts.
   */
  attestedName: text("attested_name"),
  attestedTitle: text("attested_title"),
  attestedGivenName: text("attested_given_name"),
  attestedFamilyName: text("attested_family_name"),
  /** The postal address for the certificate's "Anschrift:" line (P60-03). */
  attestedAddress: text("attested_address"),
  /** GDPR Art. 7(1): when the Punktemeldung consent was given, and to what. */
  consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
  consentDocument: text("consent_document"),
  ...timestamps,
});

export const contentProgress = pgTable("content_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  contentId: uuid("content_id").notNull(),
  status: progressStatus("status").notNull().default("not_started"),
  watchedPercent: integer("watched_percent").notNull().default(0),
  watchedSegments: jsonb("watched_segments").notNull().default([]),
  lastPositionSec: integer("last_position_sec").notNull().default(0),
  scorePercent: integer("score_percent"),
  ...timestamps,
});

export const quizQuestions = pgTable("quiz_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  contentId: uuid("content_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  kind: questionKind("kind").notNull().default("single"),
  prompt: text("prompt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizOptions = pgTable("quiz_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  questionId: uuid("question_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  label: text("label").notNull(),
  // Never selected into a learner-facing response (P4-01).
  isCorrect: boolean("is_correct").notNull().default(false),
});

export const quizAttempts = pgTable("quiz_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  contentId: uuid("content_id").notNull(),
  attemptNumber: integer("attempt_number").notNull(),
  correctCount: integer("correct_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  scorePercent: integer("score_percent").notNull().default(0),
  passed: boolean("passed").notNull().default(false),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quizAnswers = pgTable("quiz_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  attemptId: uuid("attempt_id").notNull(),
  questionId: uuid("question_id").notNull(),
  selectedOptionIds: uuid("selected_option_ids").array().notNull().default([]),
  isCorrect: boolean("is_correct").notNull(),
});

export const evaluations = pgTable("evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  courseId: uuid("course_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  prompt: text("prompt").notNull(),
  kind: text("kind").notNull(),
  required: boolean("required").notNull().default(true),
  options: jsonb("options").notNull().default([]),
});

export const evaluationResponses = pgTable("evaluation_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  evaluationId: uuid("evaluation_id").notNull(),
  answer: jsonb("answer").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eivSubmissions = pgTable("eiv_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  vnr: text("vnr").notNull(),
  efn: text("efn").notNull(),
  rolle: text("rolle").notNull().default("TEILNEHMER"),
  status: eivStatus("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  externalReference: text("external_reference"),
  eventEndAt: timestamp("event_end_at", { withTimezone: true }).notNull(),
  reportDueAt: timestamp("report_due_at", { withTimezone: true }).notNull(),
  firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }),
  correctionWindowEndsAt: timestamp("correction_window_ends_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
});

export const certificates = pgTable("certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  enrolmentId: uuid("enrolment_id").notNull(),
  status: certificateStatus("status").notNull().default("pending"),
  downloadToken: text("download_token").notNull().unique(),
  participantName: text("participant_name").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  /** The last transport failure. A code, never a server message (P8-03). */
  deliveryError: text("delivery_error"),
  deliveryAttemptCount: integer("delivery_attempt_count").notNull().default(0),
  /** Also the worker's lease — see `claim_due_certificate_deliveries`. */
  deliveryNextAttemptAt: timestamp("delivery_next_attempt_at", { withTimezone: true }),
  deliveryFirstAttemptAt: timestamp("delivery_first_attempt_at", { withTimezone: true }),
  /** One of `DeliveryAbandonReason`. Non-null means the queue has stopped. */
  deliveryAbandonedReason: text("delivery_abandoned_reason"),
  /**
   * The archived PDF (P60-01): the bytes as issued, kept for verification.
   * All three together or none — `certificates_archive_all_or_nothing`.
   */
  pdfObjectKey: text("pdf_object_key"),
  pdfSha256: text("pdf_sha256"),
  pdfArchivedAt: timestamp("pdf_archived_at", { withTimezone: true }),
  ...timestamps,
});

/**
 * The platform's own mail sender (P40-01).
 *
 * A singleton: `id` may only ever be `true`, so the write path is one
 * `INSERT … ON CONFLICT (id) DO UPDATE` and there is no "which row" to get
 * wrong. `passwordEnc` is write-only — encrypted with the application KMS key
 * and never returned by any endpoint, like `projects.smtpPasswordEnc`.
 */
export const platformSmtp = pgTable("platform_smtp", {
  id: boolean("id").primaryKey().default(true),
  host: text("host"),
  port: integer("port"),
  username: text("username"),
  passwordEnc: bytea("password_enc"),
  secure: boolean("secure").notNull().default(false),
  fromAddress: text("from_address"),
  fromName: text("from_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

/**
 * A local participant's password-reset token (P40-03).
 *
 * Keyed on the identity rather than the person, like `learner_credentials`:
 * only a `local` credential has a password to reset.
 */
export const learnerCredentialTokens = pgTable("learner_credential_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userIdentityId: uuid("user_identity_id").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  projectId: uuid("project_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: uuid("customer_id"),
  actorId: uuid("actor_id"),
  /**
   * Which population `actorId` names: `learner`, `staff` or `system`
   * (ADR-0012). Constrained in migration 0020 to agree with `actorId` — one is
   * null exactly when the other is `system`.
   */
  actorIdentity: text("actor_identity").notNull(),
  action: text("action").notNull(),
  subject: text("subject"),
  detail: jsonb("detail").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every object-storage operation, including the refusals (migration 0029).
 *
 * Append-only in the database: `ds_app` holds INSERT and SELECT and nothing
 * else, so a Drizzle `update` or `delete` against this table is a runtime
 * permission error rather than a silent no-op. There is deliberately no
 * relation defined on `actorId` — it names either an `admin_users` row or a
 * `users` row, and `actorKind` is what says which (ADR-0012).
 */
export const storageAuditLog = pgTable("storage_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  customerId: uuid("customer_id").notNull(),
  courseId: uuid("course_id"),
  /** `staff` | `learner` | `system`. */
  actorKind: text("actor_kind").notNull(),
  actorId: uuid("actor_id"),
  /** `mint` | `store` | `refuse` | `read` | `delete`. */
  action: text("action").notNull(),
  objectKey: text("object_key").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  mimeType: text("mime_type"),
  succeeded: boolean("succeeded").notNull(),
  /** A short technical reason written by us. Never a request value. */
  detail: text("detail"),
});

export const schema = {
  customers,
  departments,
  projects,
  courses,
  modules,
  chapters,
  contents,
  courseExperts,
  users,
  userIdentities,
  userCustomers,
  efnProfiles,
  userRoles,
  enrolments,
  contentProgress,
  quizQuestions,
  quizOptions,
  quizAttempts,
  quizAnswers,
  evaluations,
  evaluationResponses,
  eivSubmissions,
  certificates,
  platformSmtp,
  learnerCredentialTokens,
  auditLog,
  storageAuditLog,
};
