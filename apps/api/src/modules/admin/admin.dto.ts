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
  /**
   * Editorial state (P53-01). `draft` means no learner can see this course:
   * not listed, 404 on the detail route, refused by enrol.
   */
  status: z.enum(["draft", "published"]),
  /** Whether the course refuses content changes (P178-01). */
  contentLocked: z.boolean(),
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
  /**
   * Which credit a Punktemeldung claims for this course (P31-02).
   *
   * A setting rather than a constant because the Ärztekammer accredits each
   * event for its own point values, and only it can say which flags a course
   * may claim — S25. `GET /admin/courses/{slug}/eiv/event` reports what the
   * authority holds, so the two can be compared without guessing.
   */
  eivPunkteBasis: z.boolean(),
  eivPunkteLernerfolg: z.boolean(),
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
  /**
   * Publish or retract the course (P53-01).
   *
   * The one field on this form that changes who can see the course rather than
   * what it says. A new course is created as a draft — invisible to learners,
   * not listed, 404 on its detail route — and stays that way until somebody
   * sets this. Setting it back to `draft` retracts it: existing enrolments
   * keep their record and can no longer advance, exactly as an expired
   * validity window behaves (P51-02).
   */
  status: z.enum(["draft", "published"]).optional(),
  /**
   * The content lock (P178-01).
   *
   * Settable on create and on update, because the client asked for both: *"we
   * need to provide a locked mode that can be set when a course is created"*
   * and *"a course in lock mode can be unlocked"*. The server sets it too, the
   * first time an enrolment completes.
   *
   * It governs structure, never the course's own fields — see the column
   * comment in migration 0050.
   */
  contentLocked: z.boolean().optional(),
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
  eivPunkteBasis: z.boolean().optional(),
  eivPunkteLernerfolg: z.boolean().optional(),
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
  "withdrawn",
]);

/**
 * A certificate's delivery, as the participant list needs it (P179-01).
 *
 * Every field has been in the database since P8-03 or P118-02 and returned by
 * nothing. That is §9.3 one layer out: not a rule nobody calls, but a
 * *diagnosis nobody can read*, on the one screen where somebody is trying to
 * help a physician who has not received their Teilnahmebescheinigung.
 */
export const certificateDeliverySchema = z.object({
  /** Keys the resend, regenerate, revoke and download routes. */
  id: z.uuid(),
  /**
   * Why delivery was given up on (P118-02), or null while it has not been.
   * Decides whether resending could possibly land: `no_recipient` and
   * `permanent_rejection` cannot, and offering the button for them is §9.2.
   */
  abandonedReason: z
    .enum(["no_recipient", "permanent_rejection", "attempts_exhausted"])
    .nullable(),
  /**
   * The channel's own words for the last failure — `SMTP 550`,
   * `ECONNREFUSED`, `no SMTP host configured`, `unknown transport error`.
   *
   * A fixed vocabulary, not the far end's prose. `DeliveryChannel` in
   * `@ds/plugin-api` forbids a reason that carries the recipient or the
   * transport credentials; `classify` in `@ds/mail` produces only the strings
   * above; and `smtp.test.ts` asserts an address never reaches the outcome. So
   * this is safe to show an operator who can already see the participant's
   * address one column to the left (§9.5).
   */
  lastError: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  firstAttemptAt: z.iso.datetime().nullable(),
  /** When the sweep will try again, or null if it will not. */
  nextAttemptAt: z.iso.datetime().nullable(),
});

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
  /**
   * The Fortbildung is finished — videos and quiz (P51-01). A participant can
   * sit here for days before supplying the Evaluationsbogen and their EFN, and
   * a list that showed only `complete` reported those people as if they had
   * dropped out.
   */
  courseComplete: z.boolean(),
  /** Certified: the point is earned and the Punktemeldung is queued. */
  complete: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  /** Null on enrolments certified before the date was recorded. */
  courseCompletedAt: z.iso.datetime().nullable(),
  eivState: eivStateSchema,
  eivAttempts: z.number().int().nonnegative(),
  eivReportDueAt: z.iso.datetime().nullable(),
  /**
   * The document's state. `revoked` was missing until P179-01 — `certificates`
   * has carried it since migration 0023, `certificate?.status` passes it
   * straight through, and the console then rendered an empty cell for a
   * certificate somebody had deliberately withdrawn.
   */
  certificateState: z.enum([
    "none",
    "pending",
    "issued",
    "delivered",
    "bounced",
    "revoked",
  ]),
  /**
   * Why it is in that state, and what can be done about it (P179-01).
   *
   * Separate from `certificateState` rather than folded into it: the state is
   * one value with one home, and this is the diagnosis. Null when no
   * certificate exists — which `certificateState: "none"` already says, so
   * nothing here has to be read to know that.
   *
   * The client asked for exactly this, having been shown a single word:
   *
   *   > what does `undeliverable` mean, i need a retry button, i need error
   *   > handling, i need debugging
   */
  certificate: certificateDeliverySchema.nullable(),
  /**
   * The last four digits of the physician's EFN, or null (P179-03).
   *
   * `docs/gdpr.md` §2 said the admin surface carries `efnPresent` and never the
   * number; it is amended with this ticket, and the amendment is narrow. Two
   * admin screens have masked EFNs already — Lernende since P12-05,
   * Punktemeldungen since P31 — and a support operator asked to sort out a
   * wrong EFN on *this* screen was the one person who could not see enough to
   * confirm which number was wrong.
   *
   * Eleven dots and four digits, from `maskEfn`. It confirms a number somebody
   * is reading aloud and discloses nothing to anybody who does not already
   * have it.
   */
  efnMasked: z.string().nullable(),
  /**
   * Whether the queued Punktemeldung will send a different EFN from the one on
   * the physician's profile (P179-03). Null when there is nothing to compare.
   *
   * A boolean rather than the two values, for the reason `efnMasked` is
   * masked: the operator needs the fact, not the identifiers.
   */
  efnDivergesFromReport: z.boolean().nullable(),
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
export type CertificateDelivery = z.infer<typeof certificateDeliverySchema>;
export type ParticipantRow = z.infer<typeof participantRowSchema>;
export type ParticipantList = z.infer<typeof participantListSchema>;
export type EivState = z.infer<typeof eivStateSchema>;
