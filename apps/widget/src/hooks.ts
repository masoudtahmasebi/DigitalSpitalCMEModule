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
import {
  isNotFound,
  isUnauthenticated,
  problemDetail,
  type ApiClient,
  type ApiError,
} from "@ds/sdk";
import { de } from "./locale/de.js";
import { NO_TOKEN_HELD, TokenUnavailableError } from "./token.js";

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
 * The learner-facing sentence for a failure, in German.
 *
 * The predicates and the `detail` extraction live in `@ds/sdk`, which owns
 * `ApiError`. What stays here is the copy: a 401 means "the host page could
 * not produce a valid token", which a physician fixes by reloading and logging
 * in — not by retrying, and not by reading whatever the API called it.
 *
 * ## Except when the request never carried a token at all (P101-03)
 *
 * `TokenUnavailableError` is raised before any request goes out, by the
 * provider that could not get one from the host page. It is checked *first*
 * because the alternative was the whole defect: the widget sent an
 * unauthenticated request, got the 401 it was always going to get, and told a
 * signed-in physician their session had expired. Signing in again cannot fix a
 * token endpoint answering 404, so that sentence sent the one person who could
 * not help into a loop and told nobody who could.
 */
export function describeError(
  error: Error | undefined,
  copy: { unauthenticated: string; generic: string; noCourse: string },
): string {
  if (error === undefined) return copy.generic;
  if (error instanceof TokenUnavailableError) {
    return error.reason === NO_TOKEN_HELD
      ? de.signedOut.message
      : `${de.tokenUnavailable.message} ${de.tokenUnavailable.detail(error.reason)}`;
  }
  if (isUnauthenticated(error)) return copy.unauthenticated;
  if (isNotFound(error)) return copy.noCourse;
  // `detail` is the German message the API wrote for a learner to read; it is
  // deliberately free of identifiers and stack traces (CLAUDE.md §5).
  return problemDetail(error) ?? copy.generic;
}

// Re-exported so a screen imports its failure vocabulary from one place.
export { isUnauthenticated } from "@ds/sdk";
