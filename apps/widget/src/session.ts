/**
 * Is this the end of the session, or a bad minute? (P62-05)
 *
 * ## Why the distinction has to exist
 *
 * `LessonScreen` swallows flush failures on purpose: a learner cannot act on a
 * dropped heartbeat, the next flush retries, and the server recomputes the
 * union from everything ever reported, so watching on converges on the truth.
 *
 * **A 401 breaks all three.** The SDK has already spent its single refresh
 * attempt (P5-02), so the failure is permanent; every later flush fails
 * identically; and nothing converges, because nothing is accepted. QA measured
 * it against a 60-second token — twenty-five minutes of a physician's evening
 * would be credited as nothing, with "Ihr Fortschritt wird automatisch
 * gespeichert" on screen throughout.
 *
 * Pure and separate so the decision can be tested without a media element:
 * `LessonScreen`'s `flush` is the caller, and `PlayerScreen` renders the
 * consequence.
 */

import { ApiError } from "@ds/sdk";

/** True only for an authentication failure — never for a transport problem. */
export function isSessionExpired(error: unknown): boolean {
  // 403 is deliberately not included: it means the session is valid and the
  // caller may not do this, which no reload fixes and which the progress route
  // cannot produce for an enrolled learner anyway.
  return error instanceof ApiError && error.problem.status === 401;
}
