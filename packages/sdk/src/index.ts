/**
 * Generated API client (P2-06).
 *
 * The typed surface in `src/generated/` is produced from
 * `contracts/openapi.yaml` by `pnpm --filter @ds/sdk generate` and is never
 * hand-edited — CI fails if it drifts from the contract.
 *
 * This file is the thin hand-written half: transport (base URL, the two
 * credentials every request carries, problem-details errors) plus typed
 * methods whose shapes come from the generated schema, so the widget and the
 * API cannot disagree about a response without CI noticing.
 */

import type { components, operations } from "./generated/schema.js";

export type { components, operations, paths } from "./generated/schema.js";

export type CourseSummary = components["schemas"]["CourseSummary"];
export type CourseDetail = components["schemas"]["CourseDetail"];
export type CourseListResponse = components["schemas"]["CourseListResponse"];
export type ModuleSummary = components["schemas"]["ModuleSummary"];
export type ChapterSummary = components["schemas"]["ChapterSummary"];
export type ContentSummary = components["schemas"]["ContentSummary"];
export type CourseExpert = components["schemas"]["CourseExpert"];
export type DeliveryType = components["schemas"]["DeliveryType"];
export type HealthStatus = components["schemas"]["HealthStatus"];

export type EnrolmentState = components["schemas"]["EnrolmentState"];
export type ModuleState = components["schemas"]["ModuleState"];
export type ChapterState = components["schemas"]["ChapterState"];
export type ContentState = components["schemas"]["ContentState"];
export type ProgressSummary = components["schemas"]["ProgressSummary"];
export type GateStatus = components["schemas"]["GateStatus"];
export type CompletionCondition = components["schemas"]["CompletionCondition"];
export type ContentKind = components["schemas"]["ContentKind"];
export type LessonContent = components["schemas"]["LessonContent"];
export type MediaSource = components["schemas"]["MediaSource"];
export type MediaSourceWrite = components["schemas"]["MediaSourceWrite"];
export type WatchedSegment = components["schemas"]["WatchedSegment"];
export type ProgressReport = components["schemas"]["ProgressReport"];
export type ProgressResult = components["schemas"]["ProgressResult"];
export type RejectedSegment = components["schemas"]["RejectedSegment"];
export type Quiz = components["schemas"]["Quiz"];
export type QuizQuestion = components["schemas"]["QuizQuestion"];
export type QuizOption = components["schemas"]["QuizOption"];
export type QuizSubmission = components["schemas"]["QuizSubmission"];
export type QuizAttemptResult = components["schemas"]["QuizAttemptResult"];
export type MaterialLibrary = components["schemas"]["MaterialLibrary"];
export type MaterialGroup = components["schemas"]["MaterialGroup"];
export type Material = components["schemas"]["Material"];
export type Evaluation = components["schemas"]["Evaluation"];
export type EvaluationQuestion = components["schemas"]["EvaluationQuestion"];
export type EvaluationSubmission = components["schemas"]["EvaluationSubmission"];
export type Certificate = components["schemas"]["Certificate"];
export type CompletionInput = components["schemas"]["CompletionInput"];

export type AdminCourseSummary = components["schemas"]["AdminCourseSummary"];
export type AdminCourseDetail = components["schemas"]["AdminCourseDetail"];
export type AdminCourseUpdate = components["schemas"]["AdminCourseUpdate"];
export type CertificateAssetUpload = components["schemas"]["CertificateAssetUpload"];
export type ParticipantRow = components["schemas"]["ParticipantRow"];
export type ParticipantList = components["schemas"]["ParticipantList"];
export type EivState = components["schemas"]["EivState"];
export type Branding = components["schemas"]["Branding"];
export type FontUpload = components["schemas"]["FontUpload"];
export type FontState = components["schemas"]["FontState"];

// Authoring (P9-02, P9-04, P9-05). The read shapes carry learner-record counts
// so the console can disable a delete *and say why* before it is clicked; the
// write shapes carry no ordinal anywhere, because position is position in an
// array.
export type DepartmentSummary = components["schemas"]["DepartmentSummary"];
export type DepartmentCreate = components["schemas"]["DepartmentCreate"];
export type DepartmentUpdate = components["schemas"]["DepartmentUpdate"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type ProjectCreate = components["schemas"]["ProjectCreate"];
export type ProjectUpdate = components["schemas"]["ProjectUpdate"];
export type CourseCreate = components["schemas"]["CourseCreate"];
export type CourseStructure = components["schemas"]["CourseStructure"];
export type AuthoringModule = components["schemas"]["AuthoringModule"];
export type AuthoringChapter = components["schemas"]["AuthoringChapter"];
export type AuthoringContent = components["schemas"]["AuthoringContent"];
export type AuthoringExpert = components["schemas"]["AuthoringExpert"];
export type ModuleWrite = components["schemas"]["ModuleWrite"];
export type ChapterWrite = components["schemas"]["ChapterWrite"];
export type ContentWrite = components["schemas"]["ContentWrite"];
export type StructureOrder = components["schemas"]["StructureOrder"];
export type ExpertsWrite = components["schemas"]["ExpertsWrite"];
export type AuthoringQuiz = components["schemas"]["AuthoringQuiz"];
export type QuizWrite = components["schemas"]["QuizWrite"];
export type AuthoringEvaluation = components["schemas"]["AuthoringEvaluation"];
export type EvaluationWrite = components["schemas"]["EvaluationWrite"];

export type CourseListQuery = NonNullable<
  operations["listCourses"]["parameters"]["query"]
>;

/** RFC 7807 problem details, the single error shape across the whole API. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
}

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly response: Response,
  ) {
    super(`${problem.status} ${problem.title}`);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  readonly baseUrl: string;
  /**
   * The project slug sent as X-DS-Project on every request (ADR-0007). This is
   * what tells the API which host surface is calling — it resolves the
   * Keycloak realm to validate the token against and pins the tenant.
   */
  readonly projectSlug: string;
  /**
   * Resolves the current bearer token. Async because the widget fetches it from
   * the WordPress endpoint and may need to refresh first (ADR-0003).
   */
  readonly getToken: () => Promise<string | undefined>;
  /** Called on a 401 so the caller can refresh exactly once, never in a loop. */
  readonly onUnauthorized?: () => Promise<string | undefined>;
}

export function createClient(options: ClientOptions) {
  async function request<T>(
    path: string,
    init: RequestInit = {},
    isRetry = false,
  ): Promise<T> {
    const token = await options.getToken();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-ds-project", options.projectSlug);
    if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

    const response = await fetch(new URL(path, options.baseUrl), {
      ...init,
      headers,
    });

    // P5-02: a 401 triggers exactly one refresh attempt, never a loop.
    if (response.status === 401 && !isRetry && options.onUnauthorized) {
      const refreshed = await options.onUnauthorized();
      if (refreshed !== undefined) return request<T>(path, init, true);
    }

    if (!response.ok) {
      throw new ApiError(await readProblem(response), response);
    }

    // 204 is a real success shape in this API — `PUT /profile/efn` returns it
    // deliberately, because echoing an EFN back is exactly what ADR-0004
    // forbids. Parsing an empty body as JSON would turn that into an error.
    if (response.status === 204) return undefined as T;

    return (await response.json()) as T;
  }

  /**
   * A request whose response is bytes, not JSON.
   *
   * Separate from `request` rather than a flag on it because the two differ in
   * more than parsing: this one must not set `accept: application/json`, and
   * its caller wants the `Response` so it can read the filename out of
   * `content-disposition`.
   */
  async function requestBlob(path: string, isRetry = false): Promise<Response> {
    const token = await options.getToken();
    const headers = new Headers();
    headers.set("x-ds-project", options.projectSlug);
    if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

    const response = await fetch(new URL(path, options.baseUrl), { headers });

    if (response.status === 401 && !isRetry && options.onUnauthorized) {
      const refreshed = await options.onUnauthorized();
      if (refreshed !== undefined) return requestBlob(path, true);
    }

    if (!response.ok) {
      throw new ApiError(await readProblem(response), response);
    }

    return response;
  }

  function json(body: unknown, method: "POST" | "PUT" | "PATCH" = "POST"): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const course = (slug: string) => `/courses/${encodeURIComponent(slug)}`;
  const adminCourse = (slug: string) => `/admin/courses/${encodeURIComponent(slug)}`;
  const seg = (value: string) => encodeURIComponent(value);

  return {
    request,
    requestBlob,

    health: (): Promise<HealthStatus> => request("/health"),

    /**
     * White-label branding for this project (P10-08).
     *
     * Public: the widget renders branded loading and error states before it
     * has a token, and the admin console's login screen never has one.
     */
    getBranding: (): Promise<Branding> => request("/branding"),

    /**
     * The URL of the project's uploaded font, for an `@font-face` rule.
     *
     * A URL rather than a fetch: the browser must load this itself so it is
     * cached and reused, and because a font fetched with `fetch()` would then
     * need a blob URL for no benefit. Same origin as the API, never a CDN —
     * that is the whole point of storing it (P10-08).
     */
    brandingFontUrl: (version: string): string => {
      // The project slug travels as a query parameter here, not as the usual
      // `X-DS-Project` header: a browser loading a font from an `@font-face`
      // rule sends no custom headers, and there is no hook to add one. The
      // route accepts both for exactly this reason.
      const url = new URL("/branding/font", options.baseUrl);
      url.searchParams.set("project", options.projectSlug);
      url.searchParams.set("v", version);
      return url.toString();
    },

    listCourses: (query: CourseListQuery = {}): Promise<CourseListResponse> => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      const qs = search.toString();
      return request(qs === "" ? "/courses" : `/courses?${qs}`);
    },

    getCourseBySlug: (slug: string): Promise<CourseDetail> => request(course(slug)),

    /**
     * Idempotent: enrolling twice returns the same enrolment.
     *
     * **PUT**, matching `operationId: enrol` in the contract. It was `POST`
     * until a demo run showed a first-time learner getting a 404 and never
     * reaching a course — the API only ever declared `PUT`. Nothing caught it:
     * the parity test compares *shapes*, the integration suite calls the
     * endpoint directly with its own verb, and the widget's tests stub this
     * client. `methodOf` below is what closes that gap.
     */
    enrol: (slug: string): Promise<EnrolmentState> =>
      request(`${course(slug)}/enrolment`, { method: "PUT" }),

    getEnrolment: (slug: string): Promise<EnrolmentState> =>
      request(`${course(slug)}/enrolment`),

    /** The lesson payload, behind the sequence gate. */
    getLesson: (slug: string, contentId: string): Promise<LessonContent> =>
      request(`${course(slug)}/contents/${encodeURIComponent(contentId)}`),

    /**
     * Report watched intervals. The returned percentage is the server's own
     * recomputation — the widget renders that figure and never its own.
     */
    recordProgress: (
      slug: string,
      contentId: string,
      report: ProgressReport,
    ): Promise<ProgressResult> =>
      request(
        `${course(slug)}/contents/${encodeURIComponent(contentId)}/progress`,
        json(report),
      ),

    getQuiz: (slug: string, contentId: string): Promise<Quiz> =>
      request(`${course(slug)}/contents/${encodeURIComponent(contentId)}/quiz`),

    submitQuiz: (
      slug: string,
      contentId: string,
      submission: QuizSubmission,
    ): Promise<QuizAttemptResult> =>
      request(
        `${course(slug)}/contents/${encodeURIComponent(contentId)}/quiz`,
        json(submission),
      ),

    getMaterials: (slug: string): Promise<MaterialLibrary> =>
      request(`${course(slug)}/materials`),

    getEvaluation: (slug: string): Promise<Evaluation> =>
      request(`${course(slug)}/evaluation`),

    submitEvaluation: (
      slug: string,
      submission: EvaluationSubmission,
    ): Promise<EnrolmentState> => request(`${course(slug)}/evaluation`, json(submission)),

    /** Write-only. There is deliberately no `getEfn` — see ADR-0004. */
    setEfn: (efn: string): Promise<void> =>
      request("/profile/efn", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ efn }),
      }),

    completeCourse: (
      slug: string,
      input: CompletionInput = {},
    ): Promise<EnrolmentState> => request(`${course(slug)}/completion`, json(input)),

    getCertificate: (slug: string): Promise<Certificate> =>
      request(`${course(slug)}/certificate`),

    /** The rendered PDF plus the filename the server chose for it. */
    downloadCertificate: async (
      slug: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const response = await requestBlob(`${course(slug)}/certificate/pdf`);
      return {
        blob: await response.blob(),
        filename: filenameFromDisposition(response.headers.get("content-disposition")),
      };
    },

    // ----------------------------------------------------------------
    // Admin console (P9). Refused with 403 for a learner token — the
    // navigation hiding these is a convenience, the API is the gate.
    // ----------------------------------------------------------------

    adminListCourses: (): Promise<AdminCourseSummary[]> => request("/admin/courses"),

    adminGetCourse: (slug: string): Promise<AdminCourseDetail> =>
      request(adminCourse(slug)),

    adminUpdateCourse: (
      slug: string,
      update: AdminCourseUpdate,
    ): Promise<AdminCourseDetail> => request(adminCourse(slug), json(update, "PATCH")),

    adminSetCertificateAssets: (
      slug: string,
      upload: CertificateAssetUpload,
    ): Promise<AdminCourseDetail> =>
      request(`${adminCourse(slug)}/certificate-assets`, json(upload, "PUT")),

    /** The project's white-label font: metadata only, never the bytes. */
    adminGetFont: (): Promise<FontState> => request("/admin/branding/font"),

    adminSetFont: (upload: FontUpload): Promise<FontState> =>
      request("/admin/branding/font", json(upload, "PUT")),

    adminClearFont: (): Promise<FontState> =>
      request("/admin/branding/font", { method: "DELETE" }),

    adminListParticipants: (slug: string): Promise<ParticipantList> =>
      request(`${adminCourse(slug)}/participants`),

    adminExportParticipants: async (
      slug: string,
    ): Promise<{ blob: Blob; filename: string }> => {
      const response = await requestBlob(`${adminCourse(slug)}/participants.csv`);
      return {
        blob: await response.blob(),
        filename: filenameFromDisposition(
          response.headers.get("content-disposition"),
          `teilnehmende-${slug}.csv`,
        ),
      };
    },

    // ----------------------------------------------------------------
    // Authoring (P9-02, P9-04, P9-05)
    //
    // Every structure mutation returns the whole `CourseStructure` rather
    // than the row it touched. That looks wasteful and is not: a create
    // shifts nothing but a reorder shifts everything, and a console that
    // patched its own local tree after each call would eventually hold a
    // shape the server does not. One response, one truth — the same reason
    // the widget renders the server's watched percentage instead of its own.
    // ----------------------------------------------------------------

    adminListDepartments: (): Promise<DepartmentSummary[]> =>
      request("/admin/departments"),

    adminCreateDepartment: (input: DepartmentCreate): Promise<DepartmentSummary[]> =>
      request("/admin/departments", json(input)),

    adminUpdateDepartment: (
      slug: string,
      update: DepartmentUpdate,
    ): Promise<DepartmentSummary[]> =>
      request(`/admin/departments/${seg(slug)}`, json(update, "PATCH")),

    adminListProjects: (): Promise<ProjectSummary[]> => request("/admin/projects"),

    adminCreateProject: (input: ProjectCreate): Promise<ProjectSummary[]> =>
      request("/admin/projects", json(input)),

    /**
     * Edit a project. `smtpPassword` is write-only and never comes back —
     * `hasSmtpPassword` on the response is its only trace.
     */
    adminUpdateProject: (
      slug: string,
      update: ProjectUpdate,
    ): Promise<ProjectSummary[]> =>
      request(`/admin/projects/${seg(slug)}`, json(update, "PATCH")),

    adminCreateCourse: (input: CourseCreate): Promise<CourseStructure> =>
      request("/admin/courses", json(input)),

    adminGetStructure: (slug: string): Promise<CourseStructure> =>
      request(`${adminCourse(slug)}/structure`),

    adminCreateModule: (slug: string, input: ModuleWrite): Promise<CourseStructure> =>
      request(`${adminCourse(slug)}/modules`, json(input)),

    adminUpdateModule: (id: string, input: ModuleWrite): Promise<CourseStructure> =>
      request(`/admin/modules/${seg(id)}`, json(input, "PATCH")),

    /** Refused with 409 if any learner record points into it. */
    adminDeleteModule: (id: string): Promise<CourseStructure> =>
      request(`/admin/modules/${seg(id)}`, { method: "DELETE" }),

    adminCreateChapter: (
      moduleId: string,
      input: ChapterWrite,
    ): Promise<CourseStructure> =>
      request(`/admin/modules/${seg(moduleId)}/chapters`, json(input)),

    adminUpdateChapter: (id: string, input: ChapterWrite): Promise<CourseStructure> =>
      request(`/admin/chapters/${seg(id)}`, json(input, "PATCH")),

    adminDeleteChapter: (id: string): Promise<CourseStructure> =>
      request(`/admin/chapters/${seg(id)}`, { method: "DELETE" }),

    adminCreateContent: (
      chapterId: string,
      input: ContentWrite,
    ): Promise<CourseStructure> =>
      request(`/admin/chapters/${seg(chapterId)}/contents`, json(input)),

    adminUpdateContent: (id: string, input: ContentWrite): Promise<CourseStructure> =>
      request(`/admin/contents/${seg(id)}`, json(input, "PATCH")),

    adminDeleteContent: (id: string): Promise<CourseStructure> =>
      request(`/admin/contents/${seg(id)}`, { method: "DELETE" }),

    /**
     * Reorder the whole tree in one request.
     *
     * Not per-list, because a chapter dragged between two modules changes both
     * and two requests would leave it briefly belonging to neither. The server
     * validates every level as a permutation before writing anything, so a
     * request that is wrong anywhere changes nothing anywhere.
     */
    adminReorderStructure: (
      slug: string,
      order: StructureOrder,
    ): Promise<CourseStructure> =>
      request(`${adminCourse(slug)}/structure/order`, json(order, "PUT")),

    adminReplaceExperts: (slug: string, input: ExpertsWrite): Promise<CourseStructure> =>
      request(`${adminCourse(slug)}/experts`, json(input, "PUT")),

    /**
     * The quiz **with** its answer key — the only call in this SDK that
     * returns `isCorrect`, and one a learner token cannot make.
     */
    adminGetQuiz: (contentId: string): Promise<AuthoringQuiz> =>
      request(`/admin/contents/${seg(contentId)}/quiz`),

    adminSetQuiz: (contentId: string, input: QuizWrite): Promise<AuthoringQuiz> =>
      request(`/admin/contents/${seg(contentId)}/quiz`, json(input, "PUT")),

    adminGetEvaluation: (slug: string): Promise<AuthoringEvaluation> =>
      request(`${adminCourse(slug)}/evaluation`),

    adminSetEvaluation: (
      slug: string,
      input: EvaluationWrite,
    ): Promise<AuthoringEvaluation> =>
      request(`${adminCourse(slug)}/evaluation`, json(input, "PUT")),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

// ---------------------------------------------------------------------------
// Reading a failure
//
// These live here rather than in each frontend because they are about
// `ApiError`, which is defined here — and because both frontends had written
// their own copy of `error instanceof ApiError && error.problem.status === 401`,
// which is exactly the kind of predicate that drifts between two files until
// one of them is subtly wrong.
//
// What is deliberately *not* here is the copy. Each app maps a failure onto
// its own German sentences, because "the session expired" reads differently to
// a physician mid-video and to an admin on a settings screen.
// ---------------------------------------------------------------------------

/** The session is gone. The SDK has already spent its one refresh attempt. */
export function isUnauthenticated(error: unknown): boolean {
  return hasStatus(error, 401);
}

/** Authenticated, but not allowed. Never a reason to retry. */
export function isForbidden(error: unknown): boolean {
  return hasStatus(error, 403);
}

/** Not visible in this tenant — which is indistinguishable from not existing. */
export function isNotFound(error: unknown): boolean {
  return hasStatus(error, 404);
}

/*
 * There is deliberately no `isConflict` or `isRateLimited` here.
 *
 * Both existed and neither was used: every caller reaches for `problemDetail`,
 * because a 409 from this API already carries a German sentence saying *which*
 * learner records block the delete, and a predicate would only let a client
 * replace that with something vaguer. A complete-looking family of predicates
 * is not a reason to ship two nobody calls — they are API surface that has to
 * keep working.
 */

/**
 * The human-readable sentence the API wrote, if it wrote one.
 *
 * `detail` is written for a person to read and is free of identifiers and
 * stack traces by construction (`problem-details.ts` on the server). Anything
 * absent or empty comes back as `undefined` so the caller falls through to its
 * own copy — an empty string rendered as an error message is worse than a
 * generic one.
 */
export function problemDetail(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const detail = error.problem.detail;
  return detail === undefined || detail.trim() === "" ? undefined : detail;
}

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.problem.status === status;
}

/**
 * The filename the server put on the download.
 *
 * Falls back to a generic name rather than throwing: a header a proxy chose to
 * strip is not a reason to withhold a certificate the learner has earned.
 */
function filenameFromDisposition(
  header: string | null,
  fallback = "Teilnahmebescheinigung.pdf",
): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

async function readProblem(response: Response): Promise<ProblemDetails> {
  try {
    return (await response.json()) as ProblemDetails;
  } catch {
    return {
      type: "about:blank",
      title: response.statusText || "Request failed",
      status: response.status,
    };
  }
}
