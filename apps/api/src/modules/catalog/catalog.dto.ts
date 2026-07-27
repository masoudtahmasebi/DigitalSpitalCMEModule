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
  deliveryType: z.enum(["on_demand", "live", "praesenz"]),
  thema: z.array(z.string()),
  altersgruppe: z.array(z.string()),
  /** Rendered as "5 CME Punkte" in the card metadata line. */
  cmePoints: z.number().int().nullable(),
  cmeCategory: z.string().nullable(),
  moduleCount: z.number().int().nonnegative(),
  /** Sum of video durations; the widget formats "2 Stunden 30 Minuten". */
  totalDurationSec: z.number().int().nonnegative(),
});

export const contentSummarySchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  kind: z.enum(["video", "text", "quiz", "details", "material"]),
  title: z.string(),
  durationSec: z.number().int().nullable(),
  /** Mediathek downloads only. */
  fileUrl: z.string().nullable(),
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
