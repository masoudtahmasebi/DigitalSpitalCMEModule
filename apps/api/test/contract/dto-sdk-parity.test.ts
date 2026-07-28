/**
 * The contract test (P2-06, CLAUDE.md §6): every DTO the API serialises must
 * match the type the SDK generates from `contracts/openapi.yaml`.
 *
 * The chain this closes:
 *
 *   contracts/openapi.yaml
 *     → generated SDK types      (CI's drift check proves this step)
 *       → **this file**          (types agree, both directions, at compile time)
 *         → service unit tests   (real responses parse against the same zod schemas)
 *
 * So a field added to the database and the DTO but not the contract — or the
 * reverse — fails the build rather than a reviewer's attention, and a shape the
 * server can produce but the contract does not describe cannot ship.
 *
 * These assertions have already earned their place: the first draft of the
 * learning contract invented its own names for segment rejection reasons
 * instead of mirroring `SegmentRejectionReason` from `@ds/domain`.
 *
 * Type-level only — it compiles or it does not. The single `it` exists so the
 * suite appears in test output rather than passing invisibly.
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { components } from "@ds/sdk";
import type {
  courseDetailSchema,
  courseListResponseSchema,
  courseSummarySchema,
} from "../../src/modules/catalog/catalog.dto.js";
import type {
  enrolmentStateSchema,
  materialLibrarySchema,
  progressReportSchema,
  progressResultSchema,
} from "../../src/modules/learning/learning.dto.js";
import type {
  quizAttemptResultSchema,
  quizSchema,
  quizSubmissionSchema,
} from "../../src/modules/assessment/assessment.dto.js";
import type {
  efnInputSchema,
  evaluationSchema,
} from "../../src/modules/completion/completion.dto.js";
import type {
  adminCourseDetailSchema,
  adminCourseSummarySchema,
  adminCourseUpdateSchema,
  certificateAssetSchema,
  fontStateSchema,
  fontUploadSchema,
  participantListSchema,
  participantRowSchema,
} from "../../src/modules/admin/admin.dto.js";
import type { Expect, MutuallyAssignable } from "./assignable.js";

type Schemas = components["schemas"];

// Named with a leading underscore so the unused-vars rule ignores them: the
// declarations exist to be typechecked, never referenced.
type _Catalog = [
  Expect<
    MutuallyAssignable<z.infer<typeof courseSummarySchema>, Schemas["CourseSummary"]>
  >,
  Expect<MutuallyAssignable<z.infer<typeof courseDetailSchema>, Schemas["CourseDetail"]>>,
  Expect<
    MutuallyAssignable<
      z.infer<typeof courseListResponseSchema>,
      Schemas["CourseListResponse"]
    >
  >,
];

type _Learning = [
  Expect<
    MutuallyAssignable<z.infer<typeof enrolmentStateSchema>, Schemas["EnrolmentState"]>
  >,
  Expect<
    MutuallyAssignable<z.infer<typeof progressReportSchema>, Schemas["ProgressReport"]>
  >,
  Expect<
    MutuallyAssignable<z.infer<typeof progressResultSchema>, Schemas["ProgressResult"]>
  >,
  Expect<
    MutuallyAssignable<z.infer<typeof materialLibrarySchema>, Schemas["MaterialLibrary"]>
  >,
];

type _Assessment = [
  Expect<MutuallyAssignable<z.infer<typeof quizSchema>, Schemas["Quiz"]>>,
  Expect<
    MutuallyAssignable<z.infer<typeof quizSubmissionSchema>, Schemas["QuizSubmission"]>
  >,
  Expect<
    MutuallyAssignable<
      z.infer<typeof quizAttemptResultSchema>,
      Schemas["QuizAttemptResult"]
    >
  >,
];

type _Completion = [
  Expect<MutuallyAssignable<z.infer<typeof evaluationSchema>, Schemas["Evaluation"]>>,
  Expect<MutuallyAssignable<z.infer<typeof efnInputSchema>, Schemas["EfnInput"]>>,
];

type _Admin = [
  Expect<
    MutuallyAssignable<
      z.infer<typeof adminCourseSummarySchema>,
      Schemas["AdminCourseSummary"]
    >
  >,
  Expect<
    MutuallyAssignable<
      z.infer<typeof adminCourseDetailSchema>,
      Schemas["AdminCourseDetail"]
    >
  >,
  Expect<
    MutuallyAssignable<
      z.infer<typeof adminCourseUpdateSchema>,
      Schemas["AdminCourseUpdate"]
    >
  >,
  Expect<
    MutuallyAssignable<
      z.infer<typeof certificateAssetSchema>,
      Schemas["CertificateAssetUpload"]
    >
  >,
  Expect<
    MutuallyAssignable<z.infer<typeof participantRowSchema>, Schemas["ParticipantRow"]>
  >,
  Expect<
    MutuallyAssignable<z.infer<typeof participantListSchema>, Schemas["ParticipantList"]>
  >,
  Expect<MutuallyAssignable<z.infer<typeof fontUploadSchema>, Schemas["FontUpload"]>>,
  Expect<MutuallyAssignable<z.infer<typeof fontStateSchema>, Schemas["FontState"]>>,
];

describe("contract: DTOs match the generated SDK types", () => {
  it("compiles — the type assertions above are the test", () => {
    expect(true).toBe(true);
  });
});
