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
export type ReadingAcknowledgement = components["schemas"]["ReadingAcknowledgement"];
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
export type MediaCheckReport = components["schemas"]["MediaCheckReport"];
export type MediaCheckResult = components["schemas"]["MediaCheckResult"];
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
export type LearnerRecord = components["schemas"]["LearnerRecord"];
/** A person who learns with a customer, as an administrator sees them (P21-04). */
export type ParticipantAccount = components["schemas"]["ParticipantAccount"];
export type ParticipantMergePreview = components["schemas"]["ParticipantMergePreview"];
export type ParticipantMergeParty = components["schemas"]["ParticipantMergeParty"];
export type CertificateRecord = components["schemas"]["CertificateRecord"];
export type EivEvent = components["schemas"]["EivEvent"];
export type EivConnectionReport = components["schemas"]["EivConnectionReport"];
export type EivCheckStep = components["schemas"]["EivCheckStep"];
export type EivReconciliation = components["schemas"]["EivReconciliation"];
export type EivSubmissionPage = components["schemas"]["EivSubmissionPage"];
export type EivSubmissionRow = components["schemas"]["EivSubmissionRow"];
export type EivSubmissionQuery = NonNullable<
  operations["adminListEivSubmissions"]["parameters"]["query"]
>;
export type EivReconciliationRow = components["schemas"]["EivReconciliationRow"];
export type StaffAccount = components["schemas"]["StaffAccount"];
export type StaffScope = components["schemas"]["StaffScope"];
export type StaffInvitation = components["schemas"]["StaffInvitation"];
export type CustomerSummary = components["schemas"]["CustomerSummary"];
export type SecondFactorPolicy = components["schemas"]["SecondFactorPolicy"];
export type SecondFactorPolicies = components["schemas"]["SecondFactorPolicies"];
export type SecondFactorPolicyUpdate = components["schemas"]["SecondFactorPolicyUpdate"];
export type CustomerCreate = components["schemas"]["CustomerCreate"];
export type CustomerUpdate = components["schemas"]["CustomerUpdate"];
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

export type UploadPurpose = components["schemas"]["UploadPurpose"];
export type UploadRequest = components["schemas"]["UploadRequest"];
export type UploadTicket = components["schemas"]["UploadTicket"];
export type MultipartTicket = components["schemas"]["MultipartTicket"];
export type MultipartSigned = components["schemas"]["MultipartSigned"];
export type UploadConfirmed = components["schemas"]["UploadConfirmed"];
export type UploadView = components["schemas"]["UploadView"];
export type MediaAsset = components["schemas"]["MediaAsset"];
export type MediaDescribe = components["schemas"]["MediaDescribe"];
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
  /**
   * The id under which the API logged this exact failure (P122-01).
   *
   * `problem-details.filter.ts` has put it on every error response since
   * observability landed, and no client read it — so the one string that finds
   * the failing request in the server log reached the payload and stopped
   * there. Somebody reporting "it did not work" could not hand over the thing
   * that would locate it, because nothing showed it to them.
   *
   * Safe to display. It is a random UUID minted per request and identifies a
   * log line, never a person (§9.5).
   */
  readonly correlationId?: string;
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
   * identity provider to validate the token against and pins the tenant.
   *
   * Optional, and omitted rather than sent empty when absent. The admin
   * console's platform screens — the customer registry above all — are above
   * any tenant and must work before any project exists, which is exactly the
   * state a fresh installation is in. Sending a slug that resolves to nothing
   * would 401 the one operator who could fix it.
   */
  readonly projectSlug?: string | undefined;
  /**
   * Which customer an operator is acting within, as an id (P22-03).
   *
   * The admin console's way of naming a tenant. `projectSlug` needs a project
   * to exist, and creating the first one is itself a tenant-scoped write — so a
   * customer with no projects, which is every customer on its first day, could
   * not be set up at all. Sent instead of `x-ds-project` when both are given,
   * because it is the more fundamental of the two.
   */
  readonly customerId?: string | undefined;
  /**
   * Resolves the current bearer token. Async because the widget fetches it from
   * the WordPress endpoint and may need to refresh first (ADR-0003).
   *
   * Optional because the staff plane does not use one: it authenticates with an
   * httpOnly cookie the client cannot read, which is the whole point of it
   * being httpOnly (ADR-0012).
   */
  readonly getToken?: () => Promise<string | undefined>;
  /** Called on a 401 so the caller can refresh exactly once, never in a loop. */
  readonly onUnauthorized?: () => Promise<string | undefined>;
  /**
   * `"include"` for the staff plane, so the session cookie is attached on
   * cross-origin requests from the console to the API.
   *
   * Left unset for the learner plane. A widget embedded in WordPress has no
   * cookie to send, and asking for credentials it does not have would only
   * tighten what CORS must allow.
   */
  readonly credentials?: RequestCredentials | undefined;
  /**
   * The double-submit CSRF token, echoed as `X-DS-CSRF` on state-changing
   * requests.
   *
   * A function rather than a value because it changes on every sign-in, and a
   * client built once per tab would otherwise hold the first one forever.
   */
  readonly getCsrfToken?: () => string | undefined;
}

/** Methods the API requires a CSRF token on — the same set the guard checks. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createClient(options: ClientOptions) {
  async function request<T>(
    path: string,
    init: RequestInit = {},
    isRetry = false,
  ): Promise<T> {
    const token = await options.getToken?.();
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (options.customerId !== undefined && options.customerId !== "") {
      headers.set("x-ds-customer", options.customerId);
    } else if (options.projectSlug !== undefined && options.projectSlug !== "") {
      headers.set("x-ds-project", options.projectSlug);
    }
    if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

    const csrf = options.getCsrfToken?.();
    if (csrf !== undefined && UNSAFE_METHODS.has((init.method ?? "GET").toUpperCase())) {
      headers.set("x-ds-csrf", csrf);
    }

    const response = await fetch(new URL(path, options.baseUrl), {
      ...init,
      headers,
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
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
    const token = await options.getToken?.();
    const headers = new Headers();
    if (options.customerId !== undefined && options.customerId !== "") {
      headers.set("x-ds-customer", options.customerId);
    } else if (options.projectSlug !== undefined && options.projectSlug !== "") {
      headers.set("x-ds-project", options.projectSlug);
    }
    if (token !== undefined) headers.set("authorization", `Bearer ${token}`);

    const response = await fetch(new URL(path, options.baseUrl), {
      headers,
      ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
    });

    if (response.status === 401 && !isRetry && options.onUnauthorized) {
      const refreshed = await options.onUnauthorized();
      if (refreshed !== undefined) return requestBlob(path, true);
    }

    if (!response.ok) {
      throw new ApiError(await readProblem(response), response);
    }

    return response;
  }

  /**
   * `DELETE` is in the list because subject erasure is one and still needs a
   * body: the reason is written to the audit trail, and putting it in a query
   * string would place an operator's free text in every access log between the
   * browser and the API.
   */
  function json(
    body: unknown,
    method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
  ): RequestInit {
    return {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    };
  }

  const course = (slug: string) => `/courses/${encodeURIComponent(slug)}`;
  const adminCourse = (slug: string) => `/admin/courses/${encodeURIComponent(slug)}`;
  const seg = (value: string) => encodeURIComponent(value);

  /**
   * `?course=…`, or nothing.
   *
   * An empty query string rather than `?course=` when the filter is absent:
   * the API reads a blank value as "all courses" too, but sending one makes
   * every unfiltered request look filtered in an access log.
   */
  const courseQuery = (slug: string | undefined) =>
    slug === undefined || slug === "" ? "" : `?course=${encodeURIComponent(slug)}`;

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
      url.searchParams.set("project", options.projectSlug ?? "");
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

    /**
     * Mark a text or details section as read (P167-01).
     *
     * No body: the act is the whole message. The server refuses this for a
     * video or a quiz, which have completion events of their own.
     */
    acknowledgeReading: (
      slug: string,
      contentId: string,
    ): Promise<ReadingAcknowledgement> =>
      request(
        `${course(slug)}/contents/${encodeURIComponent(contentId)}/acknowledgement`,
        { method: "POST" },
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

    /**
     * The caller's own EFN, or `null` (P54-02).
     *
     * Takes no argument, and that is the design rather than a convenience:
     * the subject is the session's, so there is no parameter through which a
     * caller could ask about anybody else (ADR-0004, amended).
     */
    getEfn: (): Promise<{ efn: string | null; required: boolean }> =>
      request("/profile/efn"),

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

    /**
     * Ask every video host in this course for one byte.
     *
     * Slow by nature — one request per distinct URL, over the network the
     * learner will use — so the console calls it on a button rather than on
     * mount.
     */
    adminCheckCourseMedia: (slug: string): Promise<MediaCheckReport> =>
      request(`${adminCourse(slug)}/media-check`),

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

    // ----------------------------------------------------------------
    // The customer registry (P12-04)
    //
    // Authenticated by the staff session cookie, not a bearer token, and
    // carrying no `X-DS-Project` header — these routes are above any tenant
    // (ADR-0012). Only `super_admin` holds the `customer` capability; every
    // other operator gets 403.
    // ----------------------------------------------------------------

    // ----------------------------------------------------------------
    // Learner records and certificates (P12-05)
    //
    // Tenant-scoped: an enrolment belongs to a customer, so these carry
    // `X-DS-Project` like the rest of the authoring surface.
    // ----------------------------------------------------------------

    /** Masked EFN only — the whole value never crosses this boundary. */
    adminListLearners: (courseSlug?: string): Promise<LearnerRecord[]> =>
      request(`/admin/learners${courseQuery(courseSlug)}`),

    // ----------------------------------------------------------------
    // Participant accounts (P21-04)
    //
    // Distinct from `adminListLearners`, which lists **enrolments** — a row per
    // person per course. These are **people**: somebody an administrator
    // created two minutes ago has no enrolment and appears on no learner
    // screen, which is exactly when they most need to be found.
    // ----------------------------------------------------------------

    adminListParticipantAccounts: (search?: string): Promise<ParticipantAccount[]> =>
      request(
        `/admin/participants${
          search === undefined || search === "" ? "" : `?q=${encodeURIComponent(search)}`
        }`,
      ),

    /**
     * Create one, and receive the **only** copy of their password.
     *
     * There is no call that returns it again, and no column it could be read
     * out of — only its Argon2id hash is stored. A caller that discards this
     * response has to reset the password, not look it up.
     */
    adminCreateParticipant: (input: {
      email: string;
      firstName: string;
      lastName: string;
    }): Promise<{ userId: string; temporaryPassword: string }> =>
      request(`/admin/participants`, json(input, "POST")),

    /** A new temporary password, and every session this person holds ended. */
    adminResetParticipantPassword: (
      userId: string,
    ): Promise<{ temporaryPassword: string }> =>
      request(`/admin/participants/${seg(userId)}/reset-password`, json({}, "POST")),

    /** Stop, or restore, an account. Disabling also ends its live sessions. */
    adminSetParticipantDisabled: (userId: string, disabled: boolean): Promise<void> =>
      request(`/admin/participants/${seg(userId)}/disabled`, json({ disabled }, "POST")),

    /**
     * What merging two credentials onto one person would do. Reads only.
     *
     * Always called before `adminMergeParticipants`: the merge is irreversible,
     * and an operator has to be shown both sides before confirming. `hasEfn`
     * says *whether* an EFN is on file, never which — no endpoint returns one
     * (ADR-0004).
     */
    adminPreviewParticipantMerge: (input: {
      sourceUserId: string;
      targetUserId: string;
    }): Promise<ParticipantMergePreview> =>
      request(`/admin/participants/merge/preview`, json(input, "POST")),

    /**
     * Merge two credentials onto one person. **Irreversible**, `super_admin`
     * only, and 409 when the merge would have to choose — two different EFNs,
     * or a course both sides are enrolled on.
     *
     * `confirm` must equal `targetUserId`; the API refuses otherwise. It is the
     * second decision an irreversible operation is worth.
     */
    adminMergeParticipants: (input: {
      sourceUserId: string;
      targetUserId: string;
      confirm: string;
    }): Promise<void> => request(`/admin/participants/merge`, json(input, "POST")),

    /** Refused with 409 once the Punktemeldung has been accepted. */
    adminCorrectLearnerName: (enrolmentId: string, name: string): Promise<void> =>
      request(`/admin/learners/${seg(enrolmentId)}/name`, json({ name }, "PATCH")),

    /**
     * GDPR Art. 17. Irreversible and cross-tenant — a physician may hold
     * enrolments at several customers and all of them are erased.
     */
    adminEraseSubject: (
      enrolmentId: string,
      reason: string,
    ): Promise<{ enrolments: number; responses: number; submissions: number }> =>
      request(`/admin/learners/${seg(enrolmentId)}`, json({ reason }, "DELETE")),

    /**
     * Read-only. Asks the Ärztekammer what it holds about this course's VNR —
     * above all the accredited period, outside which every Punktemeldung is
     * refused.
     */
    adminDescribeEivEvent: (slug: string): Promise<EivEvent> =>
      request(`/admin/courses/${seg(slug)}/eiv/event`),

    /**
     * Prove the VNR and password reach EIV (P103-01).
     *
     * `vnrPassword` is optional and goes in the **body**, never the path or a
     * query — a password in a URL reaches the access log, the history and every
     * proxy between here and the server. Nothing in the response carries it
     * back.
     *
     * A resolved promise does not mean the connection works. It means the
     * report is trustworthy; the caller reads `steps`.
     */
    adminCheckEivConnection: (
      slug: string,
      input: { vnrPassword?: string; environment?: "configured" | "test" } = {},
    ): Promise<EivConnectionReport> =>
      request(`/admin/courses/${seg(slug)}/eiv/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),

    /** What we sent, against what the authority holds. */
    adminReconcileEiv: (slug: string): Promise<EivReconciliation> =>
      request(`/admin/courses/${seg(slug)}/eiv/reported`),

    /**
     * The Punktemeldung queue (P110-01).
     *
     * The listing the requeue and withdraw methods below always needed: they
     * take an `enrolmentId` and, until this existed, nothing produced one.
     */
    adminListEivSubmissions: (
      query: EivSubmissionQuery = {},
    ): Promise<EivSubmissionPage> => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      const qs = search.toString();
      return request(
        qs === "" ? "/admin/eiv/submissions" : `/admin/eiv/submissions?${qs}`,
      );
    },

    /** Put an abandoned Punktemeldung back in the worker's queue. */
    adminRequeueEivSubmission: (enrolmentId: string): Promise<void> =>
      request(`/admin/learners/${seg(enrolmentId)}/eiv`, { method: "POST" }),

    /**
     * Withdraw a Punktemeldung. Not a deletion — EIV keeps the record with the
     * points zeroed, and refuses this outside the correction window.
     */
    adminWithdrawEivSubmission: (enrolmentId: string, reason: string): Promise<void> =>
      request(`/admin/learners/${seg(enrolmentId)}/eiv`, json({ reason }, "DELETE")),

    adminListCertificates: (courseSlug?: string): Promise<CertificateRecord[]> =>
      request(`/admin/certificates${courseQuery(courseSlug)}`),

    /** Re-renders the document. Reports nothing to EIV. */
    adminRegenerateCertificate: (id: string): Promise<void> =>
      request(`/admin/certificates/${seg(id)}/regenerate`, { method: "POST" }),

    adminResendCertificate: (id: string): Promise<void> =>
      request(`/admin/certificates/${seg(id)}/resend`, { method: "POST" }),

    /** Withdraws the document and keeps the record. */
    adminRevokeCertificate: (id: string): Promise<void> =>
      request(`/admin/certificates/${seg(id)}/revoke`, { method: "POST" }),

    // ----------------------------------------------------------------
    // Operator accounts (P12-05)
    //
    // Above any tenant — no `X-DS-Project` — so the console calls these
    // through its platform client.
    // ----------------------------------------------------------------

    adminListStaff: (): Promise<StaffAccount[]> => request("/admin/staff"),

    /** Returns a single-use token; it is not emailed. */
    /**
     * `delivered` says whether the platform emailed the invitation (P40-05).
     *
     * The token comes back either way — an invitation must not be lost because
     * a mail server was down — so this is what decides whether the console
     * tells the inviter to hand the link over or that it is already in an
     * inbox.
     */
    /**
     * Create an operator: with a password, or with an invitation link.
     *
     * `token` is `null` when `input.password` was given — there is no link to
     * hand over, because the account already has a password.
     */
    adminInviteStaff: (
      input: StaffInvitation,
    ): Promise<{ status: string; token: string | null; delivered: boolean }> =>
      request("/admin/staff", json(input)),

    /** Set or change an operator's password. Revokes their sessions. */
    adminSetStaffPassword: (id: string, password: string): Promise<void> =>
      request(`/admin/staff/${seg(id)}/password`, json({ password })),

    adminSetStaffScope: (id: string, scope: StaffScope): Promise<void> =>
      request(`/admin/staff/${seg(id)}/scope`, json(scope)),

    /** Disabling revokes every session in the same statement. */
    adminSetStaffDisabled: (id: string, disabled: boolean): Promise<void> =>
      request(`/admin/staff/${seg(id)}/disabled`, json({ disabled })),

    adminSignOutStaffEverywhere: (id: string): Promise<void> =>
      request(`/admin/staff/${seg(id)}/sign-out-everywhere`, { method: "POST" }),

    /**
     * Clear an operator's second factor so they can enrol a new device.
     *
     * Does not sign them in and does not relax their policy: under `required`
     * their next sign-in goes to enrolment. Every session they hold is revoked.
     * Nobody may reset their own (P22-02).
     */
    adminResetStaffSecondFactor: (id: string): Promise<void> =>
      request(`/admin/staff/${seg(id)}/second-factor/reset`, { method: "POST" }),

    adminGetSecondFactorPolicy: (): Promise<SecondFactorPolicies> =>
      request("/admin/auth/second-factor/policy"),

    /** `customerId: null` is the platform's own — `super_admin` only. */
    adminSetSecondFactorPolicy: (
      input: SecondFactorPolicyUpdate,
    ): Promise<{ status: string }> =>
      request("/admin/auth/second-factor/policy", json(input, "PUT")),

    /** Refused with 403 while the policy governing your account is `required`. */
    adminRemoveOwnSecondFactor: (): Promise<{ status: string }> =>
      request("/admin/auth/second-factor", { method: "DELETE" }),

    adminListCustomers: (): Promise<CustomerSummary[]> => request("/admin/customers"),

    adminGetCustomer: (slug: string): Promise<CustomerSummary> =>
      request(`/admin/customers/${seg(slug)}`),

    adminCreateCustomer: (input: CustomerCreate): Promise<CustomerSummary> =>
      request("/admin/customers", json(input)),

    /** Renames only. The slug is what links and runbooks refer to. */
    adminUpdateCustomer: (
      slug: string,
      update: CustomerUpdate,
    ): Promise<CustomerSummary> =>
      request(`/admin/customers/${seg(slug)}`, json(update, "PATCH")),

    /**
     * Refused with 409 while anything is inside it, and permanently once any
     * learner record exists beneath it. The problem document's `detail` names
     * the counts, so it can be shown to the operator as-is.
     */
    adminDeleteCustomer: (slug: string): Promise<void> =>
      request(`/admin/customers/${seg(slug)}`, { method: "DELETE" }),

    adminListDepartments: (): Promise<DepartmentSummary[]> =>
      request("/admin/departments"),

    adminCreateDepartment: (input: DepartmentCreate): Promise<DepartmentSummary[]> =>
      request("/admin/departments", json(input)),

    adminUpdateDepartment: (
      slug: string,
      update: DepartmentUpdate,
    ): Promise<DepartmentSummary[]> =>
      request(`/admin/departments/${seg(slug)}`, json(update, "PATCH")),

    /** Refused with 409 while it still contains projects or courses. */
    adminDeleteDepartment: (slug: string): Promise<DepartmentSummary[]> =>
      request(`/admin/departments/${seg(slug)}`, { method: "DELETE" }),

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

    /** Refused with 409 while it still contains courses. */
    adminDeleteProject: (slug: string): Promise<ProjectSummary[]> =>
      request(`/admin/projects/${seg(slug)}`, { method: "DELETE" }),

    adminCreateCourse: (input: CourseCreate): Promise<CourseStructure> =>
      request("/admin/courses", json(input)),

    /**
     * Refused with 409 while it still contains modules, and permanently once
     * anybody has enrolled — an enrolment is the record behind a CME point.
     */
    adminDeleteCourse: (slug: string): Promise<void> =>
      request(adminCourse(slug), { method: "DELETE" }),

    adminGetStructure: (slug: string): Promise<CourseStructure> =>
      request(`${adminCourse(slug)}/structure`),

    /**
     * Ask for permission to upload, and get a signed `PUT` for exactly one object.
     *
     * The bytes do not go through this client — see `uploadToTicket`, which is
     * the only place that talks to the bucket, deliberately kept separate so
     * nothing here ever sends a credential or a signature anywhere it stores.
     */
    adminBeginUpload: (slug: string, input: UploadRequest): Promise<UploadTicket> =>
      request(`${adminCourse(slug)}/uploads`, json(input)),

    /**
     * Confirm the object landed and get the reference to store.
     *
     * Skipping this is not a shortcut: no reference, and the server has not
     * checked that the bucket holds what it approved.
     */
    adminCompleteUpload: (
      slug: string,
      key: string,
      fileName?: string,
    ): Promise<UploadConfirmed> =>
      request(
        `${adminCourse(slug)}/uploads/complete`,
        json(fileName === undefined ? { key } : { key, fileName }),
      ),

    /*
     * Multipart, for files past the threshold (P129-05).
     *
     * Three calls where the single upload has two, and the extra one repeats:
     * `adminSignUploadParts` is asked for a bounded batch as the upload
     * proceeds, and again on resume for whatever is still missing. The
     * orchestration lives in `uploadInParts` below — these are only the wire.
     */
    adminBeginMultipartUpload: (
      slug: string,
      input: UploadRequest,
    ): Promise<MultipartTicket> =>
      request(`${adminCourse(slug)}/uploads/multipart`, json(input)),

    adminSignUploadParts: (
      slug: string,
      input: { key: string; uploadId: string; partNumbers: readonly number[] },
    ): Promise<MultipartSigned> =>
      request(`${adminCourse(slug)}/uploads/multipart/sign`, json(input)),

    adminCompleteMultipartUpload: (
      slug: string,
      input: { key: string; uploadId: string },
    ): Promise<UploadConfirmed> =>
      request(`${adminCourse(slug)}/uploads/multipart/complete`, json(input)),

    /**
     * The customer's media library (P81-02).
     *
     * Flat, not under a course: the whole point is the files that outlive any
     * one course. No signed URLs come back — ask `adminViewUpload` for the ones
     * actually shown, so a list of two hundred does not mint two hundred
     * capabilities nobody uses.
     */
    adminListMedia: (
      options: { kind?: string; limit?: number } = {},
    ): Promise<MediaAsset[]> => {
      const query = new URLSearchParams();
      if (options.kind !== undefined && options.kind !== "") {
        query.set("kind", options.kind);
      }
      if (options.limit !== undefined) query.set("limit", String(options.limit));
      const suffix = query.toString();
      return request(`/admin/media${suffix === "" ? "" : `?${suffix}`}`);
    },

    /** A human title and the alt text a screen reader announces (P81-03). */
    adminDescribeMedia: (id: string, input: MediaDescribe): Promise<MediaAsset> =>
      request(`/admin/media/${seg(id)}`, json(input, "PATCH")),

    /**
     * Forget a library entry. The object in storage is untouched.
     *
     * Refused with 409 while any course content still points at the file.
     */
    adminForgetMedia: (id: string): Promise<void> =>
      request(`/admin/media/${seg(id)}`, { method: "DELETE" }),

    /**
     * A short-lived read URL for a library entry (P88-01).
     *
     * `adminViewUpload` authorises by the course whose prefix the key sits
     * under. The Mediathek screen is not inside a course and has no slug to
     * offer, so this authorises by the entry's own id — which RLS already
     * bounds to the caller's tenant.
     */
    adminViewMedia: (id: string): Promise<UploadView> =>
      request(`/admin/media/${seg(id)}/view`, { method: "POST" }),

    /**
     * Turn a stored `s3://` reference back into something a browser can fetch.
     *
     * For the console only, and short-lived. It is what lets the content form
     * show an author the file they uploaded and read a video's own length —
     * neither of which a key can do.
     */
    adminViewUpload: (slug: string, reference: string): Promise<UploadView> =>
      request(`${adminCourse(slug)}/uploads/view`, json({ reference })),

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

/**
 * The id to quote when reporting a failure (P122-01).
 *
 * Rendered beside an error message so a report can name the exact request. It
 * is what turns "the certificate did not download on Tuesday" into one line in
 * a log — the difference between a bug that is reproduced and one that is
 * argued about.
 */
export function problemCorrelationId(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const id = error.problem.correlationId;
  return id === undefined || id.trim() === "" ? undefined : id;
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

/**
 * Send a file to object storage using a ticket from `adminBeginUpload`.
 *
 * ## Why this is not `request`
 *
 * It talks to a bucket, not to the API, and everything `request` does would be
 * wrong here. No bearer token, no session cookie, no CSRF header, no tenant
 * header: the ticket's signature *is* the authorisation, and sending a
 * credential to a third-party host because the code path happened to be shared
 * is exactly the mistake a shared helper would eventually make. `credentials`
 * is left at the default, which does not attach cookies cross-origin.
 *
 * ## Why XHR and not fetch
 *
 * `fetch` cannot report upload progress. A lecture is hundreds of megabytes and
 * takes minutes; a spinner with no percentage in front of that is indis-
 * tinguishable from a hang, and the author's reasonable response to a hang is
 * to reload the page and start again. `XMLHttpRequest.upload.onprogress` is the
 * only thing in the platform that answers "how far along is this".
 *
 * ## What it deliberately does not do
 *
 * It does not retry. A failed PUT has to start over from zero — there is no
 * multipart or resumable path yet — so an automatic retry would silently
 * re-send hundreds of megabytes on a connection that has just demonstrated it
 * cannot carry them. That is the author's decision to make, with a button.
 */
export function uploadToTicket(
  ticket: UploadTicket,
  file: Blob,
  options: {
    /** 0–100, integer. Called often; cheap to handle. */
    readonly onProgress?: (percent: number) => void;
    /** Abort the upload — `signal.abort()` stops it and rejects. */
    readonly signal?: AbortSignal;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new Error("upload cancelled"));
      return;
    }

    const request = new XMLHttpRequest();
    request.open(ticket.method, ticket.url, true);

    for (const [name, value] of Object.entries(ticket.headers)) {
      request.setRequestHeader(name, value);
    }

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || options.onProgress === undefined) return;
      options.onProgress(Math.floor((event.loaded / event.total) * 100));
    };

    request.onload = () => {
      // 2xx and nothing else. A 403 here is the bucket refusing the signature —
      // a different content type, a different length, or an expired ticket —
      // and the body is S3's XML, which is not something to show an author.
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`object storage refused the upload (${request.status})`));
    };

    request.onerror = () => reject(new Error("the connection to object storage failed"));
    request.ontimeout = () => reject(new Error("the upload timed out"));
    request.onabort = () => reject(new Error("upload cancelled"));

    options.signal?.addEventListener("abort", () => request.abort(), { once: true });

    request.send(file);
  });
}

/**
 * Send a large file in parts (P129-05).
 *
 * ## What this is for
 *
 * `uploadToTicket` above is one signed PUT, and its own header says why it does
 * not retry: a failed upload starts from zero, so re-sending automatically
 * would push hundreds of megabytes down a connection that has just shown it
 * cannot carry them. That reasoning is exactly what stops applying once the
 * file is cut into parts — a failed **part** is 32 MiB, and retrying it is
 * cheap enough to be the obvious thing to do.
 *
 * So this retries, in a way the single-PUT path deliberately did not.
 *
 * ## The three properties that matter
 *
 * **Bounded concurrency.** Three parts at once. More is not faster on a domestic
 * or clinic connection — it is the same bandwidth divided further, with more
 * ways to fail — and each in-flight part holds a signed URL.
 *
 * **Signatures are asked for as they are needed**, never all at once. A 5 GiB
 * file is 160 parts; minting 160 capabilities because the upload started would
 * leave 157 of them live if the author closed the tab at part 3.
 *
 * **The slicing is the server's plan, not this function's opinion.** `partBytes`
 * comes back from `begin` and the server signs against the same number. A
 * client that chose its own would assemble an object of the right size and the
 * wrong bytes — which verifies as the right *size* and plays as garbage.
 *
 * ## What it does not do
 *
 * It does not resume across a page load. The bucket knows what it holds and
 * `complete` reads that, so the *server* side of resume is real; what is
 * missing is the browser remembering the `uploadId` after a reload. That is a
 * separate piece of work and is called out rather than half-built — see
 * `docs/backlog/P129.md`.
 */
export async function uploadInParts(
  api: {
    adminBeginMultipartUpload: (
      slug: string,
      input: UploadRequest,
    ) => Promise<MultipartTicket>;
    adminSignUploadParts: (
      slug: string,
      input: { key: string; uploadId: string; partNumbers: readonly number[] },
    ) => Promise<MultipartSigned>;
    adminCompleteMultipartUpload: (
      slug: string,
      input: { key: string; uploadId: string },
    ) => Promise<UploadConfirmed>;
  },
  slug: string,
  file: Blob,
  input: UploadRequest,
  options: {
    readonly onProgress?: (percent: number) => void;
    readonly signal?: AbortSignal;
    /** Injected by the tests; the browser path uses `putPart` below. */
    readonly put?: (url: string, body: Blob, signal?: AbortSignal) => Promise<void>;
    readonly concurrency?: number;
    readonly attemptsPerPart?: number;
    /** Injected so a test does not wait out a real backoff. */
    readonly delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<UploadConfirmed> {
  const put = options.put ?? putPart;
  const concurrency = options.concurrency ?? 3;
  const attempts = options.attemptsPerPart ?? 4;
  const delay = options.delay ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  const ticket = await api.adminBeginMultipartUpload(slug, input);

  /*
   * Progress is **bytes confirmed**, not parts finished.
   *
   * Counting parts on a 96-part upload moves the bar once a minute in visible
   * steps; counting bytes as each part completes is the same information at a
   * resolution a person reads as movement. Within-part progress is deliberately
   * not plumbed through: three parts in flight reporting independently makes a
   * bar that goes backwards.
   */
  let sent = 0;
  const total = file.size;
  const report = () => {
    if (options.onProgress === undefined || total === 0) return;
    options.onProgress(Math.min(100, Math.floor((sent / total) * 100)));
  };

  const partNumbers = Array.from({ length: ticket.partCount }, (_, i) => i + 1);
  const queue = [...partNumbers];
  const signed = new Map<number, string>();

  /** Sign the next batch, bounded by what the contract accepts. */
  const ensureSigned = async (wanted: readonly number[]): Promise<void> => {
    const missing = wanted.filter((part) => !signed.has(part));
    if (missing.length === 0) return;
    const batch = await api.adminSignUploadParts(slug, {
      key: ticket.key,
      uploadId: ticket.uploadId,
      partNumbers: missing.slice(0, 32),
    });
    for (const part of batch.parts) signed.set(part.partNumber, part.url);
  };

  const sliceOf = (partNumber: number): Blob => {
    const start = (partNumber - 1) * ticket.partBytes;
    return file.slice(start, Math.min(start + ticket.partBytes, total));
  };

  // Read through a function so TypeScript does not narrow the first check and
  // then treat the ones inside the retry loop as unreachable.
  const aborted = (): boolean => options.signal?.aborted ?? false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (aborted()) throw new Error("upload cancelled");
      const partNumber = queue.shift();
      if (partNumber === undefined) return;

      await ensureSigned([partNumber]);
      let url = signed.get(partNumber);
      if (url === undefined) throw new Error("the server did not sign this part");

      const body = sliceOf(partNumber);

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await put(url, body, options.signal);
          sent += body.size;
          report();
          break;
        } catch (error) {
          // A cancelled upload is not a failed one, and must not be retried.
          if (aborted()) throw error;
          if (attempt === attempts) throw error;
          /*
           * Exponential, and the signature is discarded before the retry.
           *
           * A part that failed near its URL's expiry would fail again for the
           * same reason however many times it is tried; dropping it from the
           * cache means the next attempt asks for a fresh one.
           */
          signed.delete(partNumber);
          await delay(2 ** (attempt - 1) * 500);
          await ensureSigned([partNumber]);
          const fresh = signed.get(partNumber);
          if (fresh === undefined) throw error;
          url = fresh;
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ticket.partCount) }, () => worker()),
  );

  return api.adminCompleteMultipartUpload(slug, {
    key: ticket.key,
    uploadId: ticket.uploadId,
  });
}

/**
 * One part, over XHR.
 *
 * XHR rather than `fetch` for the same reason `uploadToTicket` uses it, and no
 * headers at all: the part's signature does not bind a content type, so setting
 * one would be a header the bucket did not sign for. No credentials either —
 * this is a third-party host and the signature is the whole authorisation.
 */
function putPart(url: string, body: Blob, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("upload cancelled"));
      return;
    }
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`object storage refused a part (${request.status})`));
    };
    request.onerror = () => reject(new Error("the connection to object storage failed"));
    request.ontimeout = () => reject(new Error("the part timed out"));
    request.onabort = () => reject(new Error("upload cancelled"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}
