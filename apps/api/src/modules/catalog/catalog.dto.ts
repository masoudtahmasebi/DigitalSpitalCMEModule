/**
 * Catalog DTOs (P2-05) — the interface layer's contract.
 *
 * These types are what leaves the server. The critical property, asserted by
 * test: **there is no field capable of carrying a quiz answer key**. P4-01
 * requires that no learner-facing response can reveal a correct answer, and the
 * strongest way to guarantee that is for the shape to have nowhere to put one.
 *
 * Mirrors `contracts/openapi.yaml`; the generated SDK derives from the same
 * source, so the widget and the API cannot disagree about the shape.
 */

import { z } from "zod";

export const courseSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** Course artwork — the list card and the detail hero use the same asset. */
  heroImageUrl: z.string().nullable(),
  deliveryType: z.enum(["on_demand", "live", "praesenz"]),
  thema: z.array(z.string()),
  altersgruppe: z.array(z.string()),
  /** Rendered as "5 CME Punkte" in the card metadata line. */
  cmePoints: z.number().int().nullable(),
  cmeCategory: z.string().nullable(),
  moduleCount: z.number().int().nonnegative(),
  /** Sum of video durations; the widget formats "2 Stunden 30 Minuten". */
  totalDurationSec: z.number().int().nonnegative(),
  /**
   * The caller's own standing on this course, or `null` if they have not
   * enrolled.
   *
   * The card's CTA depends on it: _Zur Fortbildung_ for a course not yet
   * started, _Fortbildung fortsetzen_ for one in progress (layout §4.1). A
   * client cannot work that out from the summary alone, and fetching an
   * enrolment per card would be a request per row.
   *
   * **Deliberately not a percentage.** A course's progress percentage is the
   * output of `rollupProgress` over the whole course tree, and there is exactly
   * one path to it (CLAUDE.md §4 invariant 6). Producing it for ten cards would
   * mean ten tree builds per list request, and the cheap approximation that
   * invites — counting completed contents, say — would be a second answer to
   * "how far has this person got", which is the thing the invariant exists to
   * prevent. Both fields here are stored columns: a row exists, and
   * `completed_at` is or is not null.
   */
  enrolment: z
    .object({
      /** `completed_at IS NOT NULL` — the course is finished. */
      complete: z.boolean(),
    })
    .nullable(),
});

/**
 * What a course *contains*, for browsing. Never what is inside it.
 *
 * Deliberately carries no `fileUrl`, no `videoUrl` and no `body`. This is an
 * ungated browse response — anyone holding a token for the tenant can read it,
 * whether or not they have finished module 1. Putting a URL here would make
 * both padlocks in the product decorative at once: the Mediathek's, which
 * withholds `fileUrl` until the module is complete, and the player's, which
 * withholds `videoUrl` until the chapter is reachable.
 *
 * A URL that a client is merely asked not to use is not a gate. The gated
 * shapes are `Material` (via `GET /materials`) and `LessonContent` (via
 * `GET /contents/{id}`), and they are the only ones that carry a URL.
 *
 * `mimeType` stays: it is metadata for an icon, and knowing a download is a
 * PDF discloses nothing the title does not.
 */
export const contentSummarySchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  kind: z.enum(["video", "text", "quiz", "details", "material"]),
  title: z.string(),
  durationSec: z.number().int().nullable(),
  mimeType: z.string().nullable(),
});

export const chapterSummarySchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  title: z.string(),
  contents: z.array(contentSummarySchema),
});

export const moduleSummarySchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  title: z.string(),
  subtitle: z.string().nullable(),
  chapters: z.array(chapterSummarySchema),
});

export const courseExpertSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  roleLabel: z.string(),
  name: z.string(),
  institution: z.string().nullable(),
  biography: z.string().nullable(),
  photoUrl: z.string().nullable(),
});

/**
 * The whole tree in one response, so the widget's detail view does not
 * waterfall (P2-05 acceptance criterion).
 *
 * `requiredWatchPercent` and `passThresholdPercent` are exposed deliberately:
 * the Zertifizierung tab must render the course's *actual* configured values
 * rather than a hardcoded number, which is what makes the 80 %/100 % copy
 * contradiction impossible to ship (P5-06).
 */
export const courseDetailSchema = courseSummarySchema.extend({
  /** The "Lernziele" checklist, one entry per bullet. */
  learningObjectives: z.array(z.string()),
  /** The "Zielgruppe" section; plain text, newlines are the only formatting. */
  targetAudience: z.string().nullable(),
  vnr: z.string().nullable(),
  accreditationBody: z.string().nullable(),
  organizer: z.string().nullable(),
  eventLocation: z.string().nullable(),
  validFrom: z.iso.datetime().nullable(),
  validTo: z.iso.datetime().nullable(),
  requiredWatchPercent: z.number().int().min(0).max(100),
  passThresholdPercent: z.number().int().min(0).max(100),
  modules: z.array(moduleSummarySchema),
  experts: z.array(courseExpertSchema),
});

export const courseListQuerySchema = z.object({
  thema: z.string().optional(),
  altersgruppe: z.string().optional(),
  deliveryType: z.enum(["on_demand", "live", "praesenz"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(50).default(10),
});

export const courseListResponseSchema = z.object({
  items: z.array(courseSummarySchema),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  facets: z.object({
    thema: z.array(z.object({ value: z.string(), count: z.number().int() })),
    altersgruppe: z.array(z.object({ value: z.string(), count: z.number().int() })),
  }),
});

export type CourseSummary = z.infer<typeof courseSummarySchema>;
export type CourseDetail = z.infer<typeof courseDetailSchema>;
export type CourseListQuery = z.infer<typeof courseListQuerySchema>;
export type CourseListResponse = z.infer<typeof courseListResponseSchema>;
export type ModuleSummary = z.infer<typeof moduleSummarySchema>;
export type ContentSummary = z.infer<typeof contentSummarySchema>;
