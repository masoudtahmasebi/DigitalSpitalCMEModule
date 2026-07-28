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

    return (await response.json()) as T;
  }

  return {
    request,

    health: (): Promise<HealthStatus> => request("/health"),

    listCourses: (query: CourseListQuery = {}): Promise<CourseListResponse> => {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      const qs = search.toString();
      return request(qs === "" ? "/courses" : `/courses?${qs}`);
    },

    getCourseBySlug: (slug: string): Promise<CourseDetail> =>
      request(`/courses/${encodeURIComponent(slug)}`),
  };
}

export type ApiClient = ReturnType<typeof createClient>;

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
