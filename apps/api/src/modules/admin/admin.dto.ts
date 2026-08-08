/**
 * Admin console DTOs (P9). Mirrors `contracts/openapi.yaml`.
 *
 * Two rules shape every shape in this file.
 *
 * **Secrets are write-only.** The VNR password and the SMTP password can be
 * set here and are never returned by anything — not masked, not as a length,
 * not as a boolean derived from the ciphertext beyond "is one stored". A field
 * that can be read is a field that can leak, and these authenticate
 * DigitalSpital to a legally binding accreditation interface (CLAUDE.md §4
 * invariant 7).
 *
 * **Images are reported by presence, never by bytes.** The certificate assets
 * are a few kilobytes each, but an admin list that embedded them would put
 * megabytes of base64 on a screen that only needs to say "a stamp is on file".
 */

import { z } from "zod";

/** Percentages are integers 0–100 (CLAUDE.md §5). */
const percent = z.number().int().min(0).max(100);

export const adminCourseSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  deliveryType: z.enum(["on_demand", "live", "praesenz"]),
  thema: z.array(z.string()),
  altersgruppe: z.array(z.string()),
  learningObjectives: z.array(z.string()),
  targetAudience: z.string().nullable(),
  /** The "Vorkenntnisse" paragraph (layout page 02). */
  prerequisites: z.string().nullable(),
  heroImageUrl: z.string().nullable(),
  fortbildungsnummer: z.string().nullable(),
  /** ISO 8601. The accreditation window from the Anerkennungsbescheid. */
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  vnr: z.string().nullable(),
  cmePoints: z.number().int().nullable(),
  cmeCategory: z.string().nullable(),
  requiredWatchPercent: percent,
  passThresholdPercent: percent,
  enrolmentCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  /**
   * Whether this course can currently produce a valid Teilnahmebescheinigung.
   * Computed from the same rule the certificate endpoint enforces, so the
   * console cannot say "ready" for a course that would refuse to issue.
   */
  certificateReady: z.boolean(),
  missingCertificateFields: z.array(z.string()),
});

export const adminCourseDetailSchema = adminCourseSummarySchema.extend({
  organizer: z.string().nullable(),
  eventLocation: z.string().nullable(),
  accreditationBody: z.string().nullable(),
  scientificLeadName: z.string().nullable(),
  scientificLeadTitle: z.string().nullable(),
  certificateIssuePlace: z.string().nullable(),
  /** Presence only — see the module header. */
  hasStampImage: z.boolean(),
  hasSignatureImage: z.boolean(),
  hasVnrPassword: z.boolean(),
  maxQuizAttempts: z.number().int().positive().nullable(),
  revealCorrectAnswers: z.boolean(),
});

/**
 * A course edit.
 *
 * Every field optional: this is a PATCH, and an admin editing the issue place
 * must not have to resend the VNR password to avoid clearing it. `undefined`
 * means "leave alone"; `null` means "clear" for the nullable text fields.
 */
/**
 * The presentation fields (P13-01).
 *
 * Everything the learner-facing layout draws — the catalogue card, the course
 * hero, the Übersicht tab — as opposed to the accreditation fields below, which
 * exist because the certificate and the Punktemeldung need them.
 *
 * They were stored and rendered from the first day and settable only by the
 * seed script, which meant a customer could not change the title of their own
 * course without a developer. Every field a physician can see is now a field an
 * operator can edit.
 */
export const adminCourseUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(5000).nullable().optional(),
  /** Which catalogue tab the course appears under. */
  deliveryType: z.enum(["on_demand", "live", "praesenz"]).optional(),
  /**
   * Filter facets. Free text rather than a fixed taxonomy: the set differs per
   * customer — a dermatology customer's Themen are not MEDICE's — and a shared
   * enum would have to be migrated every time somebody adds one.
   */
  thema: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  altersgruppe: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  /** The Lernziele checklist. Ordered, because the layout numbers them visually. */
  learningObjectives: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  /** Zielgruppe, including the Vorkenntnisse sentence. Newlines are preserved. */
  targetAudience: z.string().max(5000).nullable().optional(),
  prerequisites: z.string().max(2000).nullable().optional(),
  /** The image beside the hero and on the catalogue card. */
  heroImageUrl: z.string().url().max(2000).nullable().optional(),
  cmePoints: z.number().int().positive().max(100).nullable().optional(),
  cmeCategory: z.string().max(50).nullable().optional(),
  fortbildungsnummer: z.string().max(100).nullable().optional(),
  /**
   * The Veranstaltungsnummer — what a Punktemeldung is credited against.
   *
   * Trimmed and length-bounded, and nothing more. The single VNR we have seen
   * is 19 digits; a regex built from one specimen would refuse a legitimate
   * number from another Ärztekammer at authoring time, which `CLAUDE.md` §7
   * calls out by name. The EIV harness validates against the real interface.
   *
   * `nullable` because a course is routinely authored before its Bescheid
   * arrives — the completion still stands, and the missing VNR is an admin
   * alert rather than a learner-facing failure (P7-07).
   */
  vnr: z.string().trim().max(100).nullable().optional(),
  /**
   * The accreditation window from the Anerkennungsbescheid. ISO 8601, and
   * `nullable` because a course may be authored before the Bescheid arrives.
   */
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),

  requiredWatchPercent: percent.optional(),
  passThresholdPercent: percent.optional(),
  organizer: z.string().max(300).nullable().optional(),
  eventLocation: z.string().max(300).nullable().optional(),
  accreditationBody: z.string().max(300).nullable().optional(),
  scientificLeadName: z.string().max(200).nullable().optional(),
  scientificLeadTitle: z.string().max(100).nullable().optional(),
  certificateIssuePlace: z.string().max(200).nullable().optional(),
  /**
   * Write-only. Never returned; `hasVnrPassword` is the only readable trace.
   * An empty string is rejected rather than treated as "clear" — clearing a
   * credential should be deliberate, not a stray form submit.
   */
  vnrPassword: z.string().min(1).max(200).optional(),
  /**
   * The admin's acknowledgement that lowering the pass threshold below the
   * accredited minimum voids the Anerkennung (P9-03). Required by the server,
   * not merely shown in the UI — a confirmation a client can skip is not a
   * confirmation.
   */
  acknowledgeAccreditationRisk: z.boolean().optional(),
});

/** PNG and JPEG only — SVG is executable markup (migration 0006). */
export const certificateAssetSchema = z.object({
  /** Base64 without a data: prefix. Bounded to the column's 512 KB. */
  stampImageBase64: z.string().max(700_000).optional(),
  stampImageMime: z.enum(["image/png", "image/jpeg"]).optional(),
  signatureImageBase64: z.string().max(700_000).optional(),
  signatureImageMime: z.enum(["image/png", "image/jpeg"]).optional(),
});

/**
 * A white-label font upload (P10-08).
 *
 * woff2 and woff only. Not because older formats are unsupported — because
 * they are unnecessary parser surface. **SVG fonts are excluded absolutely**:
 * an SVG font is executable markup, uploaded by a customer admin and served
 * from our own origin, which is a stored XSS with extra steps.
 *
 * The declared type is a claim. The service sniffs the magic bytes and the
 * column has its own CHECK; this schema only rejects the obviously malformed.
 */
export const fontUploadSchema = z.object({
  /** Base64 without a data: prefix. Bounded to the column's 2 MB. */
  fontBase64: z.string().min(1).max(2_800_000),
  fontMime: z.enum(["font/woff2", "font/woff"]).optional(),
  /**
   * The family name the CSS will refer to. Narrow, because it is emitted
   * inside an `@font-face` block where a brace ends the rule.
   */
  fontFamilyName: z
    .string()
    .regex(
      /^[A-Za-z0-9 _-]{1,64}$/,
      "letters, digits, spaces, hyphen and underscore only",
    ),
});

/**
 * What the console knows about the stored font. Metadata only — the file is
 * served by `GET /branding/font`, the same route a learner's browser uses.
 */
export const fontStateSchema = z.object({
  fontFamilyName: z.string().nullable(),
  /** The upload timestamp, used as the cache-busting version. */
  fontVersion: z.string().nullable(),
  fontBytes: z.number().int().nonnegative().nullable(),
});

export const eivStateSchema = z.enum([
  "none",
  "queued",
  "submitted",
  "failed",
  "needs_attention",
  "abandoned",
]);

export const participantRowSchema = z.object({
  enrolmentId: z.uuid(),
  /**
   * The attested name if the learner gave one, else the profile name. Never an
   * EFN — that is reported to the Ärztekammer and read back by nobody
   * (ADR-0004).
   */
  participantName: z.string(),
  email: z.string().nullable(),
  efnPresent: z.boolean(),
  watchedPercent: percent,
  quizPassed: z.boolean(),
  evaluationSubmitted: z.boolean(),
  progressPercent: percent,
  complete: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  eivState: eivStateSchema,
  eivAttempts: z.number().int().nonnegative(),
  eivReportDueAt: z.iso.datetime().nullable(),
  certificateState: z.enum(["none", "pending", "issued", "delivered", "bounced"]),
});

export const participantListSchema = z.object({
  courseSlug: z.string(),
  rows: z.array(participantRowSchema),
});

export type AdminCourseSummary = z.infer<typeof adminCourseSummarySchema>;
export type AdminCourseDetail = z.infer<typeof adminCourseDetailSchema>;
export type AdminCourseUpdate = z.infer<typeof adminCourseUpdateSchema>;
export type CertificateAssetUpload = z.infer<typeof certificateAssetSchema>;
export type FontUpload = z.infer<typeof fontUploadSchema>;
export type FontState = z.infer<typeof fontStateSchema>;
export type ParticipantRow = z.infer<typeof participantRowSchema>;
export type ParticipantList = z.infer<typeof participantListSchema>;
export type EivState = z.infer<typeof eivStateSchema>;
