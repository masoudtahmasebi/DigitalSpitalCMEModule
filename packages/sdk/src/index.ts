/**
 * Generated API client (P2-06).
 *
 * The typed surface in `src/generated/` is produced from
 * `contracts/openapi.yaml` by `pnpm --filter @ds/sdk generate` and is never
 * hand-edited — CI fails if it drifts from the contract.
 *
 * Until the contract is frozen in week 2, this package exposes only the
 * transport concerns that are contract-independent: base URL resolution, bearer
 * token attachment, and the problem-details error shape.
 */

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

  return { request };
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
