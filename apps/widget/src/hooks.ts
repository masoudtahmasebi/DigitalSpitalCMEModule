/**
 * Data hooks (P5).
 *
 * Small and hand-written rather than a data-fetching library: the widget has
 * one course, one learner and about eight endpoints, and the enrolment state is
 * a single object that every screen re-reads after any mutation. A cache with
 * invalidation keys would be more machinery than the problem has.
 *
 * The rule those eight endpoints follow: **any call that can change compliance
 * state returns the fresh `EnrolmentState`, and the widget renders that.** The
 * widget never patches its local copy — a locally-computed "you may now
 * proceed" is precisely the client-side gate CLAUDE.md §4 forbids.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "@ds/sdk";

export interface AsyncState<T> {
  readonly data: T | undefined;
  readonly error: ApiError | Error | undefined;
  readonly loading: boolean;
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);

  // Guards against a resolved request from a previous render writing over a
  // newer one — the classic out-of-order response bug.
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setState((previous) => ({ ...previous, loading: true }));

    load().then(
      (data) => {
        if (generation.current !== current) return;
        setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        setState({
          data: undefined,
          error: error instanceof Error ? error : new Error(String(error)),
          loading: false,
        });
      },
    );
    // `load` is intentionally not a dependency: it is a fresh closure every
    // render, and the caller's `deps` describe what actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, reload };
}

/** The learner's state on this course, and a way to replace it after a write. */
export function useEnrolment(client: ApiClient, courseSlug: string) {
  const state = useAsync(
    // Enrol-then-read is one call: `enrol` is idempotent and returns the same
    // state `getEnrolment` would, so a first-time visitor and a returning one
    // take the same path.
    () => client.enrol(courseSlug),
    [client, courseSlug],
  );

  return state;
}

/**
 * Whether an error is the session having expired.
 *
 * The SDK has already tried exactly one refresh by the time this is asked, so
 * a 401 here means the host page could not produce a valid token — which the
 * learner fixes by reloading and logging in, not by retrying.
 */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.problem.status === 401;
}

/** The learner-facing sentence for a failure, in German, without leaking internals. */
export function describeError(
  error: Error | undefined,
  copy: { unauthenticated: string; generic: string; noCourse: string },
): string {
  if (error === undefined) return copy.generic;
  if (isUnauthenticated(error)) return copy.unauthenticated;
  if (error instanceof ApiError) {
    if (error.problem.status === 404) return copy.noCourse;
    // `detail` is the German message the API wrote for a learner to read; it
    // is deliberately free of identifiers and stack traces (CLAUDE.md §5).
    if (error.problem.detail !== undefined && error.problem.detail !== "") {
      return error.problem.detail;
    }
  }
  return copy.generic;
}
