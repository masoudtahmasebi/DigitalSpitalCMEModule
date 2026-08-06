/**
 * The single error shape crossing the API boundary (RFC 7807).
 *
 * `CLAUDE.md` §5: no stack traces and no internal identifiers reach the client.
 * That is not only tidiness — an error body is an information-disclosure
 * surface, and this system holds named physicians' participation records.
 *
 * Note the deliberate asymmetry: `AppError` carries an internal `reason` for the
 * audit log and a client-safe `detail` for the response. The two are never the
 * same field, so a future edit cannot accidentally promote internal detail into
 * a response.
 */

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
}

export type AppErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "gate_locked"
  | "rate_limited"
  | "internal";

const STATUS: Record<AppErrorKind, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  gate_locked: 403,
  rate_limited: 429,
  internal: 500,
};

const TITLE: Record<AppErrorKind, string> = {
  unauthenticated: "Unauthenticated",
  forbidden: "Forbidden",
  not_found: "Not found",
  validation: "Validation failed",
  conflict: "Conflict",
  gate_locked: "Content locked",
  rate_limited: "Too many requests",
  internal: "Internal server error",
};

export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    /** Internal, for logs and the audit trail. Never sent to a client. */
    readonly reason: string,
    /** Client-safe explanation. Omit when nothing safe can be said. */
    readonly clientDetail?: string,
  ) {
    super(reason);
    this.name = "AppError";
  }

  static notFound(reason: string, clientDetail?: string): AppError {
    return new AppError("not_found", reason, clientDetail);
  }

  static forbidden(reason: string): AppError {
    return new AppError("forbidden", reason);
  }

  static unauthenticated(reason: string): AppError {
    return new AppError("unauthenticated", reason);
  }

  /**
   * A refusal the caller can act on, and which is therefore safe to echo.
   *
   * `clientDetail` is set to the same string on purpose — unlike the other
   * three, a bad-request reason is about what the caller sent, not about what
   * exists on the server, so telling them is not a disclosure. Callers that
   * would leak something must not use this helper.
   */
  static badRequest(reason: string): AppError {
    return new AppError("validation", reason, reason);
  }
}

/**
 * Convert any thrown value into a client-safe problem document.
 *
 * Anything that is not an `AppError` becomes a bare 500: an unexpected error's
 * message is, by definition, not something we have decided is safe to disclose.
 */
export function toProblemDetails(error: unknown, instance?: string): ProblemDetails {
  const app = error instanceof AppError ? error : schemaRejectionAsAppError(error);
  const kind: AppErrorKind = app?.kind ?? "internal";

  return {
    type: `https://docs.ds-education.de/errors/${kind}`,
    title: TITLE[kind],
    status: STATUS[kind],
    ...(app?.clientDetail === undefined ? {} : { detail: app.clientDetail }),
    ...(instance === undefined ? {} : { instance }),
  };
}

/**
 * A schema rejection is a 422, not a 500.
 *
 * Most controllers wrap `safeParse` in a local helper that produces a proper
 * `AppError`. Some call `schema.parse` directly, and a `ZodError` escaping to
 * the filter used to become a bare "Internal server error" — telling a caller
 * who sent a malformed body that the server is broken, and burying a
 * client-fixable mistake in the 500 rate.
 *
 * This is the safety net rather than the intended path: the local helpers say
 * *which* field is wrong, which is more useful. What matters is that missing
 * one is no longer a 500.
 *
 * Detected structurally rather than with `instanceof ZodError`. Two copies of
 * zod in a workspace — an easy state to reach with hoisting — makes
 * `instanceof` silently false, and the failure would be invisible: the code
 * would look right and produce 500s in production.
 */
export function schemaRejectionAsAppError(error: unknown): AppError | undefined {
  if (!isZodError(error)) return undefined;

  const fields = error.issues
    .map((issue) => issue.path.join("."))
    .filter((path) => path !== "")
    .join(", ");

  return new AppError(
    "validation",
    `schema rejected the request body${fields === "" ? "" : `: ${fields}`}`,
    // No issue messages: they are written for a developer and can quote the
    // rejected value, which for this API includes an EFN and a password.
    "Die Eingaben sind nicht gültig. Bitte prüfen Sie die markierten Felder.",
  );
}

function isZodError(
  error: unknown,
): error is { issues: { path: (string | number)[] }[] } {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray((error as { issues: unknown }).issues) &&
    (error as { name?: unknown }).name === "ZodError"
  );
}
