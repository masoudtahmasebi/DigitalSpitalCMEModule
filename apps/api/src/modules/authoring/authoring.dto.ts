/**
 * Authoring DTOs (P9-02, P9-04, P9-05). Mirrors `contracts/openapi.yaml`.
 *
 * ## The shape these take, and why
 *
 * Structure — modules, chapters, contents — is edited **item at a time**, so
 * that a failure affects one thing and an author knows which. Ordering is edited
 * **as a whole tree**, because a reorder is not a set of independent moves: a
 * chapter dragged from module 1 to module 2 changes both, and applying that as
 * two requests leaves a window in which it belongs to neither or both.
 *
 * Quizzes and the Evaluationsbogen are edited **as a whole document**, because
 * their parts only make sense together — a question's options are not
 * independently meaningful, and a partially-applied edit could leave a question
 * with no correct answer, which is a quiz nobody can pass.
 *
 * ## Ordinals are never sent
 *
 * Position is expressed by position in an array, never by an `ordinal` field. A
 * client that can set ordinals directly can set two items to the same one, and
 * `UNIQUE (module_id, ordinal)` then turns an authoring mistake into a 500.
 */

import { z } from "zod";
import type { Branding } from "@ds/domain";

const title = z.string().trim().min(1).max(300);
/**
 * A URL-safe identifier: lowercase, alphanumeric, hyphen-separated, 1–100
 * characters, never starting or ending with a hyphen.
 *
 * The "no leading or trailing hyphen" half is two string comparisons rather
 * than part of the pattern. The natural regex for it —
 * `[a-z0-9]+(-[a-z0-9]+)*` — nests one quantifier inside another, which is the
 * shape a backtracking engine can be made to struggle with, and this validates
 * input from a form. A flat character class plus two `startsWith` calls says
 * the same thing with no way to be surprised, and reads better besides.
 */
const SLUG_CHARACTERS = /^[a-z0-9-]{1,100}$/;

const slug = z
  .string()
  .trim()
  .regex(SLUG_CHARACTERS, "lowercase letters, digits and hyphens only, 1–100 characters")
  .refine(
    (value) => !value.startsWith("-") && !value.endsWith("-"),
    "must not start or end with a hyphen",
  );

const uuid = z.uuid();
const richText = z.string().max(20_000);
const url = z.string().url().max(2000);

// ---------------------------------------------------------------------------
// Structure: customers, departments, projects
// ---------------------------------------------------------------------------

export const customerCreateSchema = z.object({
  slug,
  name: title,
});

export const departmentCreateSchema = z.object({
  slug,
  name: title,
});

export const departmentUpdateSchema = z.object({
  name: title.optional(),
});

export const projectCreateSchema = z.object({
  departmentSlug: slug,
  slug,
  name: title,
});

/**
 * A project edit.
 *
 * The Keycloak binding is here because it is configuration, but changing it is
 * not cosmetic: it decides which realm every token for this project is
 * validated against (ADR-0003). Getting it wrong locks every learner out, which
 * is why the console warns before saving it.
 *
 * SMTP password is **write-only**, like the VNR password: settable, never
 * returned in any shape (CLAUDE.md §4 invariant 7).
 */
export const projectUpdateSchema = z.object({
  name: title.optional(),
  keycloakIssuer: url.nullable().optional(),
  keycloakAudience: z.string().trim().max(200).nullable().optional(),
  keycloakRealm: z.string().trim().max(200).nullable().optional(),
  smtpHost: z.string().trim().max(300).nullable().optional(),
  smtpPort: z.number().int().min(1).max(65535).nullable().optional(),
  smtpUsername: z.string().trim().max(300).nullable().optional(),
  /** Write-only. An empty string is rejected rather than read as "clear". */
  smtpPassword: z.string().min(1).max(300).optional(),
  smtpFromAddress: z.email().max(300).nullable().optional(),
  smtpFromName: z.string().trim().max(200).nullable().optional(),
  /**
   * Accepted loosely on purpose, then narrowed by `parseBranding`.
   *
   * The grammars that decide what a valid colour or font stack is live in
   * `@ds/domain`, and restating them here would be a second copy to keep in
   * step. So the shape is open, the domain drops what it does not recognise,
   * and the *parsed* result is what gets stored — never the submitted blob.
   */
  branding: z.record(z.string(), z.unknown()).optional(),
});

export const projectSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  departmentSlug: z.string(),
  keycloakIssuer: z.string().nullable(),
  keycloakAudience: z.string().nullable(),
  keycloakRealm: z.string().nullable(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().nullable(),
  smtpUsername: z.string().nullable(),
  smtpFromAddress: z.string().nullable(),
  smtpFromName: z.string().nullable(),
  /** Presence only — the ciphertext is never returned. */
  hasSmtpPassword: z.boolean(),
  /**
   * Always the output of `parseBranding`, never the raw jsonb column.
   *
   * `z.custom` rather than a restated object: this schema is a type source,
   * and the value has already been through the one validator that defines what
   * branding is. A second zod copy of those grammars could only ever disagree
   * with the first.
   */
  branding: z.custom<Branding>(),
  courseCount: z.number().int().nonnegative(),
});

export const departmentSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  projectCount: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Course creation
// ---------------------------------------------------------------------------

/**
 * A new course. Deliberately minimal.
 *
 * Everything a certificate needs — VNR, points, Veranstalter, the
 * Wissenschaftliche Leitung — is set afterwards on the settings screen, which
 * already knows how to refuse a pass threshold below the accredited minimum and
 * reports which certificate fields are still missing. Duplicating those rules
 * into a creation form would be a second place to get them wrong.
 */
export const courseCreateSchema = z.object({
  projectSlug: slug,
  slug,
  title,
  description: richText.nullable().optional(),
  deliveryType: z.enum(["on_demand", "live", "praesenz"]).default("on_demand"),
});

// ---------------------------------------------------------------------------
// The authoring tree
// ---------------------------------------------------------------------------

/**
 * A rendition as an author supplies it.
 *
 * `url` is a plain bounded string rather than `url` (which requires an
 * absolute URL): media may be stored as an `s3://<key>` reference, and the
 * media resolver — not this schema — decides what a stored reference may be.
 * The same reason `fileUrl` would have if it were not already a CDN URL by the
 * time it reaches here.
 *
 * The MIME type is checked against the closed list by `contentProblems`, not
 * here, so there is one place that knows what a browser can be offered.
 */
export const mediaSourceWriteSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  mimeType: z.string().trim().min(1).max(100),
  label: z.string().trim().max(60).nullable().optional(),
});

export const authoringContentSchema = z.object({
  id: uuid,
  kind: z.enum(["video", "text", "quiz", "details", "material"]),
  title: z.string(),
  body: z.string().nullable(),
  sources: z.array(mediaSourceWriteSchema),
  posterUrl: z.string().nullable(),
  captionsUrl: z.string().nullable(),
  durationSec: z.number().int().nullable(),
  fileUrl: z.string().nullable(),
  fileSize: z.number().int().nullable(),
  mimeType: z.string().nullable(),
  /**
   * How many learner records point at this item.
   *
   * The console shows it as "3 Teilnahmen erfasst" and disables deletion.
   * Better to say why up front than to let an author click delete and receive
   * a refusal they have to interpret.
   */
  learnerRecords: z.number().int().nonnegative(),
  /** Quiz items only: how many questions are authored. Zero is unusable. */
  questionCount: z.number().int().nonnegative().nullable(),
});

export const authoringChapterSchema = z.object({
  id: uuid,
  title: z.string(),
  body: z.string().nullable(),
  contents: z.array(authoringContentSchema),
});

export const authoringModuleSchema = z.object({
  id: uuid,
  title: z.string(),
  subtitle: z.string().nullable(),
  chapters: z.array(authoringChapterSchema),
});

export const courseStructureSchema = z.object({
  courseSlug: z.string(),
  title: z.string(),
  modules: z.array(authoringModuleSchema),
  experts: z.array(
    z.object({
      id: uuid,
      roleLabel: z.string(),
      name: z.string(),
      institution: z.string().nullable(),
      biography: z.string().nullable(),
      photoUrl: z.string().nullable(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Structure edits
// ---------------------------------------------------------------------------

export const moduleWriteSchema = z.object({
  title,
  subtitle: z.string().trim().max(300).nullable().optional(),
});

export const chapterWriteSchema = z.object({
  title,
  body: richText.nullable().optional(),
});

/**
 * A content item.
 *
 * Every field is accepted for every kind and the *rules* are applied by
 * `contentProblems` in `@ds/domain` — one place that knows a video needs a
 * duration, rather than five branches here and five more in the console.
 */
export const contentWriteSchema = z.object({
  kind: z.enum(["video", "text", "quiz", "details", "material"]),
  title,
  body: richText.nullable().optional(),
  sources: z.array(mediaSourceWriteSchema).max(10).optional(),
  posterUrl: url.nullable().optional(),
  /** WebVTT. Owed for every video with speech — WCAG 1.2.2 is Level A. */
  captionsUrl: url.nullable().optional(),
  durationSec: z.number().int().positive().max(86_400).nullable().optional(),
  fileUrl: url.nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  mimeType: z.string().trim().max(200).nullable().optional(),
});

/**
 * The whole tree's ordering, in one atomic request.
 *
 * Ids only: this endpoint moves things, it never edits them. A chapter listed
 * under a different module than it currently sits in **is** the move — which is
 * why this cannot be a set of per-list requests, since a chapter in flight
 * between two modules would briefly belong to neither.
 */
export const structureOrderSchema = z.object({
  modules: z.array(
    z.object({
      id: uuid,
      chapters: z.array(
        z.object({
          id: uuid,
          contents: z.array(uuid),
        }),
      ),
    }),
  ),
});

/**
 * The Experten/Referenten list, replaced wholesale.
 *
 * No learner state points at an expert, so unlike everything else in this file
 * a full replace is safe — and it is what the screen does anyway.
 */
export const expertsWriteSchema = z.object({
  experts: z
    .array(
      z.object({
        roleLabel: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(200),
        institution: z.string().trim().max(300).nullable().optional(),
        biography: richText.nullable().optional(),
        photoUrl: url.nullable().optional(),
      }),
    )
    .max(50),
});

// ---------------------------------------------------------------------------
// Assessment authoring (P9-05) — human review gate
// ---------------------------------------------------------------------------

/**
 * A quiz, as its author sees it: **with** the correct answers.
 *
 * This is the one shape in the platform that carries `isCorrect`, and it is
 * reachable only from an admin route. The learner-facing `Quiz` has no field
 * capable of holding it (`assessment.dto.ts`), which is what makes leaking it
 * a type error rather than an oversight.
 */
export const authoringQuizSchema = z.object({
  contentId: uuid,
  questions: z.array(
    z.object({
      id: uuid,
      prompt: z.string(),
      kind: z.enum(["single", "multi"]),
      /** Answers recorded against this question. Non-zero blocks deletion. */
      answerCount: z.number().int().nonnegative(),
      options: z.array(
        z.object({
          id: uuid,
          label: z.string(),
          isCorrect: z.boolean(),
        }),
      ),
    }),
  ),
});

/**
 * A quiz edit.
 *
 * `id` present means "this is the existing row, changed"; absent means "new".
 * Anything the server holds and this document does not name is a deletion — and
 * a deletion of something a learner has answered is refused, which is what
 * keeps an already-submitted attempt meaningful.
 */
export const quizWriteSchema = z.object({
  questions: z
    .array(
      z.object({
        id: uuid.optional(),
        prompt: z.string().trim().min(1).max(2000),
        kind: z.enum(["single", "multi"]),
        options: z
          .array(
            z.object({
              id: uuid.optional(),
              label: z.string().trim().min(1).max(1000),
              isCorrect: z.boolean(),
            }),
          )
          .min(2)
          .max(10),
      }),
    )
    .max(100),
});

export const authoringEvaluationSchema = z.object({
  courseSlug: z.string(),
  questions: z.array(
    z.object({
      id: uuid,
      prompt: z.string(),
      kind: z.enum(["scale", "text", "single"]),
      required: z.boolean(),
      options: z.array(z.string()),
      responseCount: z.number().int().nonnegative(),
    }),
  ),
});

export const evaluationWriteSchema = z.object({
  questions: z
    .array(
      z.object({
        id: uuid.optional(),
        prompt: z.string().trim().min(1).max(2000),
        kind: z.enum(["scale", "text", "single"]),
        required: z.boolean().default(true),
        options: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
      }),
    )
    .max(50),
});

export type CustomerCreate = z.infer<typeof customerCreateSchema>;
export type DepartmentCreate = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdate = z.infer<typeof departmentUpdateSchema>;
export type DepartmentSummary = z.infer<typeof departmentSummarySchema>;
export type ProjectCreate = z.infer<typeof projectCreateSchema>;
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type CourseCreate = z.infer<typeof courseCreateSchema>;
export type CourseStructure = z.infer<typeof courseStructureSchema>;
export type AuthoringModule = z.infer<typeof authoringModuleSchema>;
export type AuthoringChapter = z.infer<typeof authoringChapterSchema>;
export type AuthoringContent = z.infer<typeof authoringContentSchema>;
export type ModuleWrite = z.infer<typeof moduleWriteSchema>;
export type ChapterWrite = z.infer<typeof chapterWriteSchema>;
export type ContentWrite = z.infer<typeof contentWriteSchema>;
export type StructureOrder = z.infer<typeof structureOrderSchema>;
export type ExpertsWrite = z.infer<typeof expertsWriteSchema>;
export type AuthoringQuiz = z.infer<typeof authoringQuizSchema>;
export type QuizWrite = z.infer<typeof quizWriteSchema>;
export type AuthoringEvaluation = z.infer<typeof authoringEvaluationSchema>;
export type EvaluationWrite = z.infer<typeof evaluationWriteSchema>;
