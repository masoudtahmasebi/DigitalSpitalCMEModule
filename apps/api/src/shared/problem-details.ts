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
  | "internal";

const STATUS: Record<AppErrorKind, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  conflict: 409,
  gate_locked: 403,
  internal: 500,
};

const TITLE: Record<AppErrorKind, string> = {
  unauthenticated: "Unauthenticated",
  forbidden: "Forbidden",
  not_found: "Not found",
  validation: "Validation failed",
  conflict: "Conflict",
  gate_locked: "Content locked",
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

  static notFound(reason: string): AppError {
    return new AppError("not_found", reason);
  }

  static forbidden(reason: string): AppError {
    return new AppError("forbidden", reason);
  }

  static unauthenticated(reason: string): AppError {
    return new AppError("unauthenticated", reason);
  }
}

/**
 * Convert any thrown value into a client-safe problem document.
 *
 * Anything that is not an `AppError` becomes a bare 500: an unexpected error's
 * message is, by definition, not something we have decided is safe to disclose.
 */
export function toProblemDetails(error: unknown, instance?: string): ProblemDetails {
  const app = error instanceof AppError ? error : undefined;
  const kind: AppErrorKind = app?.kind ?? "internal";

  return {
    type: `https://docs.ds-education.de/errors/${kind}`,
    title: TITLE[kind],
    status: STATUS[kind],
    ...(app?.clientDetail === undefined ? {} : { detail: app.clientDetail }),
    ...(instance === undefined ? {} : { instance }),
  };
}

export function statusFor(error: unknown): number {
  return error instanceof AppError ? STATUS[error.kind] : 500;
}
