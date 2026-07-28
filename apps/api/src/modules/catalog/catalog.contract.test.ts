/**
 * The contract test (P2-06, CLAUDE.md §6): the API's zod DTOs and the SDK's
 * generated types must describe the same shapes.
 *
 * The chain this closes: `contracts/openapi.yaml` → generated SDK types (CI's
 * drift check proves that step) → **this file** proves the DTOs the API
 * actually serialises match those generated types, in both directions — a
 * field added to one side but not the other fails `tsc`, not a reviewer's
 * attention. The service tests then prove real responses parse against the
 * same zod schemas, completing yaml ⇄ SDK ⇄ DTO ⇄ runtime.
 *
 * Type-level only: `Expect<MutuallyAssignable<…>>` compiles or it does not.
 * The single `it` exists so the suite shows up in test output rather than
 * passing invisibly.
 */

import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type {
  CourseDetail as SdkCourseDetail,
  CourseListResponse as SdkCourseListResponse,
  CourseSummary as SdkCourseSummary,
} from "@ds/sdk";
import type {
  courseDetailSchema,
  courseListResponseSchema,
  courseSummarySchema,
} from "./catalog.dto.js";

type ApiCourseSummary = z.infer<typeof courseSummarySchema>;
type ApiCourseDetail = z.infer<typeof courseDetailSchema>;
type ApiCourseListResponse = z.infer<typeof courseListResponseSchema>;

/** Resolves to true only when A and B are assignable in both directions. */
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

/** Fails compilation unless T is exactly `true`. */
type Expect<T extends true> = T;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time assertions
type _Assertions = [
  Expect<MutuallyAssignable<ApiCourseSummary, SdkCourseSummary>>,
  Expect<MutuallyAssignable<ApiCourseDetail, SdkCourseDetail>>,
  Expect<MutuallyAssignable<ApiCourseListResponse, SdkCourseListResponse>>,
];

describe("contract: DTOs match the generated SDK types", () => {
  it("compiles — the assertions above are the test", () => {
    expect(true).toBe(true);
  });
});
