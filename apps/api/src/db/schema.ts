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
  keycloakIssuer: text("keycloak_issuer"),
  keycloakAudience: text("keycloak_audience"),
  keycloakRealm: text("keycloak_realm"),
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
  deliveryType: courseDeliveryType("delivery_type").notNull().default("on_demand"),
  thema: text("thema").array().notNull().default([]),
  altersgruppe: text("altersgruppe").array().notNull().default([]),
  vnr: text("vnr"),
  // Ciphertext. Read only through SecretCipher; never selected into a response.
  vnrPasswordEnc: bytea("vnr_password_enc"),
  fortbildungsnummer: text("fortbildungsnummer"),
  accreditationBody: text("accreditation_body"),
  cmePoints: integer("cme_points"),
  cmeCategory: text("cme_category"),
  eventLocation: text("event_location"),
  organizer: text("organizer"),
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
  videoUrl: text("video_url"),
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  keycloakRealm: text("keycloak_realm").notNull(),
  keycloakSub: text("keycloak_sub").notNull(),
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
  completedAt: timestamp("completed_at", { withTimezone: true }),
  attestedName: text("attested_name"),
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
  deliveryError: text("delivery_error"),
  ...timestamps,
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: uuid("customer_id"),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  subject: text("subject"),
  detail: jsonb("detail").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  auditLog,
};
