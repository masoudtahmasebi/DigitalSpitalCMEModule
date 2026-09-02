/**
 * The one way this application makes an outbound HTTP request (P144-01).
 *
 * ## Why this file exists
 *
 * `fetch` has **no default timeout**. A server that cannot reach a bucket, an
 * identity provider or a webhook therefore does not fail — it *waits*, and it
 * waits holding whatever the caller was holding. On this application that is a
 * PostgreSQL connection, because `TenantTransactionInterceptor` wraps the whole
 * request in one; ten of those and the pool is gone, which is P142 arriving by
 * a different road.
 *
 * The client has seen the consequence twice, and P70-02 is the record of the
 * exact precondition lasting months: the API container sat on an `internal`
 * Docker network with no route out, so every one of these calls was to a host
 * it could not reach, and not one of them said so.
 *
 * ## What it guarantees, and what it does not
 *
 * It guarantees that a request *ends*. It does not guarantee it succeeds, and
 * it is not a retry policy — a caller that wants one builds it on top, where
 * the decision about whether repeating is safe belongs.
 *
 * ## The rule this exists to make checkable
 *
 * `scripts/check-deadlines.mjs` fails the build on a bare `fetch(` anywhere in
 * server code. That is the point of routing everything through one function:
 * "every outbound call has a deadline" is otherwise a claim nobody can verify,
 * and §9.1 says an unverifiable claim is not evidence.
 */

/** Control-plane calls — HEAD, DELETE, list, a token exchange, a webhook. */
export const CONTROL_DEADLINE_MS = 15_000;

/**
 * Calls where the server on the other end is doing real work while we wait —
 * assembling a multipart object, streaming a backup out.
 *
 * Ninety seconds, and the ceiling is not arbitrary: a request handler holds an
 * open transaction while it waits, and `idle_in_transaction_session_timeout` is
 * 120 s (P141). A deadline above that would be decided by Postgres killing the
 * connection instead, which fails the request *and* loses the reason.
 */
export const TRANSFER_DEADLINE_MS = 90_000;

/**
 * A `fetch` that gives up.
 *
 * A caller that passes its own `signal` keeps it — that is how a call needing
 * `TRANSFER_DEADLINE_MS` asks for it, and how an upload that a person cancelled
 * stays cancellable. Combining the two would silently shorten the explicit one
 * to the default, which is the kind of helpfulness that produces a bug report
 * about large files only.
 */
export function withDeadline(
  defaultMs: number = CONTROL_DEADLINE_MS,
  impl: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    // `!== undefined && !== null`: `signal: null` is how a caller says
    // "explicitly none", and `undefined` is how it says nothing at all. Both
    // mean "you choose", so both fall through to the default.
    if (init?.signal !== undefined && init.signal !== null) {
      return impl(input, init);
    }

    try {
      return await impl(input, { ...init, signal: AbortSignal.timeout(defaultMs) });
    } catch (error) {
      throw asDeadlineError(error, input, defaultMs);
    }
  };
}

/** Raised in place of the opaque `TimeoutError` a bare abort produces. */
export class RequestDeadlineError extends Error {
  constructor(target: string, ms: number) {
    super(`no answer from ${target} within ${String(ms)} ms`);
    this.name = "RequestDeadlineError";
  }
}

function asDeadlineError(
  error: unknown,
  input: Parameters<typeof fetch>[0],
  ms: number,
): unknown {
  const timedOut =
    error instanceof DOMException
      ? error.name === "TimeoutError"
      : error instanceof Error && error.name === "TimeoutError";

  return timedOut ? new RequestDeadlineError(describe(input), ms) : error;
}

/**
 * Host and path only — **never** the query string.
 *
 * Every URL this wrapper sees on the storage path is presigned, so its query
 * carries `X-Amz-Signature` and `X-Amz-Credential`. An error message that
 * quoted the URL would put a live capability into the log, the alert and any
 * problem-details response that echoed it (§9.5, `CLAUDE.md` §4 invariant 7).
 */
function describe(input: Parameters<typeof fetch>[0]): string {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return `${url.host}${url.pathname}`;
  } catch {
    return "the upstream host";
  }
}
