/**
 * What the console says for each class of failure, and which channel says it.
 *
 * ## Why this file exists
 *
 * Two rules decide every error an operator sees, and until P225 neither had a
 * test. Both lived where answering a question about them needed a browser, an
 * API and a signed-in console:
 *
 * - `announceable` — whether the **global toast** speaks at all. It is the
 *   floor under 48 hand-written error channels (P205-01): a screen may show its
 *   own message, and a screen that shows nothing is no longer silent.
 * - `describeError` — the sentence every **inline** channel renders.
 *
 * Both shipped wrong, in the same way and for the same reason: a status that
 * is not a fault was answered with *advice to retry*, and retrying would never
 * work. See `ANSWERS_WITH_NOT_FOUND` and the note on the 403 branch.
 *
 * ## The matrix
 *
 * | Scenario     | Toast | Inline sentence                     |
 * | ------------ | ----- | ----------------------------------- |
 * | font 404     | no    | the screen's own unconfigured state |
 * | font 500     | yes   | actionable                          |
 * | other 404    | yes   | the API's own detail                |
 * | timeout      | yes   | retryable                           |
 * | offline      | yes   | retryable                           |
 * | 401          | no    | session recovery, by routing        |
 * | 403          | no    | permission, **no retry advice**     |
 */

import { describe, expect, it } from "vitest";
import { ApiError } from "@ds/sdk";
import { announceable, describeError, isRetryable } from "./api.js";
import { de } from "./locale/de.js";

/** A problem-details failure as the SDK raises it. */
function failure(status: number, detail?: string, correlationId?: string): ApiError {
  return new ApiError(
    {
      type: "about:blank",
      title: "Failure",
      status,
      ...(detail === undefined ? {} : { detail }),
      ...(correlationId === undefined ? {} : { correlationId }),
    } as never,
    new Response(null, { status }),
  );
}

/**
 * A transport failure: a timeout, a dropped connection, an offline browser.
 *
 * `fetch` rejects with a `TypeError`, not an `ApiError`, so there is **no
 * status to key on** — which makes this the most important case for the toast
 * floor and the one a status-based rule is most likely to drop.
 */
const OFFLINE = new TypeError("Failed to fetch");
const TIMEOUT = Object.assign(new Error("The operation was aborted."), {
  name: "AbortError",
});

describe("announceable — does the global toast speak?", () => {
  it("stays silent on the two statuses the console routes instead", () => {
    // 401 → the sign-in form, via `onUnauthorized`. 403 → a permission message.
    // A toast as well would be a second announcement of a handled thing.
    expect(announceable("listCourses", 401)).toBe(false);
    expect(announceable("adminDeleteCourse", 403)).toBe(false);
  });

  it("speaks for everything else, including a 404 that really is one", () => {
    // The reason the floor exists: a course opened from a stale link, a
    // participant deleted in another tab.
    expect(announceable("getCourseBySlug", 404)).toBe(true);
    expect(announceable("adminDeleteCourse", 409)).toBe(true);
    expect(announceable("adminSetFont", 422)).toBe(true);
    expect(announceable("adminListCourses", 429)).toBe(true);
    expect(announceable("adminListCourses", 500)).toBe(true);
  });

  it("speaks when there is no status at all — offline, timeout, dropped", () => {
    // The case a status-keyed rule drops silently, and the one an operator is
    // least able to diagnose alone.
    expect(announceable("listCourses", undefined)).toBe(true);
  });

  it("stays silent about the font that was never uploaded", () => {
    /*
     * `GET /admin/branding/font` 404s deliberately when a project has no font,
     * and `BrandingSettings` has caught that since P22-08. The floor announced
     * it anyway, one layer up — so every customer who had not uploaded a font
     * opened Erscheinungsbild to "Bitte versuchen Sie es später erneut", and
     * the toast outlives the screen, so it followed them onto three more.
     *
     * Fails on the previous rule.
     */
    expect(announceable("adminGetFont", 404)).toBe(false);
  });

  it("still speaks when the same route fails for a real reason", () => {
    // The exemption is one status on one method, not a blanket silence.
    expect(announceable("adminGetFont", 500)).toBe(true);
    expect(announceable("adminGetFont", 503)).toBe(true);
    expect(announceable("adminGetFont", 422)).toBe(true);
    expect(announceable("adminGetFont", undefined)).toBe(true);
  });

  it("exempts nothing else, so one entry cannot quieten the console", () => {
    /*
     * The failure mode of an exemption table is that it grows into a mute
     * button. This pins the table's size: every other method's 404 is still
     * announced, so adding an entry is a visible, reviewable act rather than
     * something a caller can do in passing — there is no option, flag or
     * argument that suppresses a class of errors from a call site.
     */
    for (const method of [
      "adminListCourses",
      "adminGetCourse",
      "adminSetFont",
      "adminListStaff",
      "getCourseBySlug",
      "adminGetProject",
    ]) {
      expect(announceable(method, 404), `${method} was silently exempted`).toBe(true);
    }
  });
});

describe("describeError — the sentence an inline channel renders", () => {
  it("never tells an operator to retry something that was refused", () => {
    /*
     * P225-05. This returned `generic` for a 403 — "Bitte versuchen Sie es
     * später erneut." — at every call site in the console, because `generic`
     * is `de.error.generic` at every call site. Retrying a refusal refuses for
     * ever: the sentence was advice and the advice was wrong (§9.4).
     *
     * Fails on the previous rule.
     */
    const sentence = describeError(
      failure(403, "actor lacks role course_editor"),
      de.error.generic,
    );

    expect(sentence).toContain(de.error.forbidden);
    expect(sentence).not.toContain(de.error.generic);
  });

  it("does not leak the API's developer-facing detail on a refusal", () => {
    // Unchanged and deliberate: that text is written for a log, and naming the
    // missing role tells an operator more than they need in order to act.
    expect(
      describeError(failure(403, "actor lacks role course_editor"), de.error.generic),
    ).not.toContain("course_editor");
  });

  it("prefers the API's own sentence for every other failure", () => {
    expect(
      describeError(failure(409, "Diese Fortbildung hat Teilnahmen."), de.error.generic),
    ).toContain("Diese Fortbildung hat Teilnahmen.");
  });

  it("falls back to the generic line when the API said nothing useful", () => {
    expect(describeError(failure(500), de.error.generic)).toContain(de.error.generic);
  });

  it("is retryable for a transport failure, which is the one worth retrying", () => {
    // No status, no problem-details, so the generic "try again later" is
    // exactly right here — the opposite of the 403 case.
    for (const error of [OFFLINE, TIMEOUT]) {
      expect(describeError(error, de.error.generic)).toContain(de.error.generic);
    }
  });

  it("carries the correlation id so a report can be traced", () => {
    expect(describeError(failure(500, undefined, "abc-123"), de.error.generic)).toContain(
      "(Referenz: abc-123)",
    );
  });

  it("carries no correlation id when the API minted none", () => {
    expect(describeError(failure(500), de.error.generic)).not.toContain("Referenz");
  });
});

describe("the two channels together", () => {
  it("never both announce the same refusal", () => {
    /*
     * The one case where a double announcement would be pure noise: a 403 is
     * already a complete sentence on screen, so the toast must not repeat it.
     * The two rules have to agree, and nothing but this test makes them.
     */
    expect(announceable("adminDeleteCourse", 403)).toBe(false);
    expect(describeError(failure(403), de.error.generic)).toContain(de.error.forbidden);
  });

  it("leaves no failure with neither channel", () => {
    /*
     * The floor's whole purpose. For every status the console can meet, either
     * the toast speaks or the console routes the operator somewhere that
     * explains it — 401 to the sign-in form, 403 to a permission sentence.
     */
    for (const status of [400, 404, 409, 422, 429, 500, 502, 503]) {
      expect(announceable("adminListCourses", status), `${status} was silent`).toBe(true);
    }
    expect(announceable("adminListCourses", undefined)).toBe(true);
  });
});

/**
 * The fallback is status-blind, and for three statuses that is the wrong
 * advice (P231-01).
 *
 * ## The defect
 *
 * `describeError` answers with the API's `detail` where there is one, and with
 * the call site's `generic` where there is not. Every call site in the console
 * passes a sentence ending *"Bitte versuchen Sie es später erneut."* — or the
 * literal `de.error.generic`, which is only that sentence.
 *
 * So the console's answer to a failure with no `detail` is **advice to retry**,
 * whatever the status was. For 429 and 5xx and a dropped connection that is
 * right. For three statuses it is the same §9.4 defect P225-01 fixed for the
 * font toast and P225-05 fixed for the 403 — *the sentence is advice, and the
 * advice is wrong*:
 *
 * | Status | Retrying the identical request will                        |
 * | ------ | ----------------------------------------------------------- |
 * | `404`  | not find it again — the thing is gone                       |
 * | `409`  | hit the same conflict — somebody else's change is still there |
 * | `422`  | be rejected identically — the input is what was refused     |
 *
 * ## Why it matters more than the 403 did
 *
 * **`AppError.notFound(reason)` takes an optional `clientDetail` and 42 of its
 * 45 call sites omit it.** `reason` is internal by design and never sent. So
 * forty-two distinct 404s in this API reach an operator as "please try again
 * later", and one of them is the second click of a GDPR erasure (P230-01),
 * where the correct reading is "it already worked".
 *
 * Counted, not estimated: `AppError.notFound` 42 without / 3 with;
 * `unauthenticated` 21 / 1; `badRequest` 8 / 2; `new AppError(...)` 14 / 117.
 */
describe("the sentence matches the status, not just the absence of a detail", () => {
  const RETRY_ADVICE = "später erneut";

  it("does not tell an operator to retry a 404", () => {
    const sentence = describeError(failure(404), de.error.generic);
    expect(
      sentence,
      "a 404 answered with retry advice — the thing is gone and asking again " +
        "will not bring it back (42 of 45 `AppError.notFound` call sites send " +
        "no detail, so this is the sentence they all produce)",
    ).not.toContain(RETRY_ADVICE);
    expect(sentence).toBe(de.error.gone);
  });

  it("does not tell an operator to retry a 409", () => {
    const sentence = describeError(failure(409), de.error.generic);
    expect(
      sentence,
      "a 409 answered with retry advice — the same request meets the same " +
        "conflict; the operator has to see the current state first",
    ).not.toContain(RETRY_ADVICE);
    expect(sentence).toBe(de.error.conflict);
  });

  it("does not tell an operator to retry a 422", () => {
    const sentence = describeError(failure(422), de.error.generic);
    expect(
      sentence,
      "a 422 answered with retry advice — the input is what was refused, so " +
        "sending it again is refused again",
    ).not.toContain(RETRY_ADVICE);
    expect(sentence).toBe(de.error.rejected);
  });

  /*
   * The other half, and the reason this is not "never say retry": for these
   * four, retrying is exactly the right advice, and a rule that suppressed it
   * everywhere would take away the one useful sentence the console has.
   */
  it("still tells an operator to retry the things that are worth retrying", () => {
    for (const [name, error] of [
      ["429 rate limited", failure(429)],
      ["502 upstream", failure(502)],
      ["500 internal", failure(500)],
      ["a dropped connection", OFFLINE],
      ["a timeout", TIMEOUT],
    ] as const) {
      expect(
        describeError(error, de.error.generic),
        `${name} lost its retry advice — this one really is worth trying again`,
      ).toContain(RETRY_ADVICE);
    }
  });

  /*
   * And the guarantee that keeps the table from becoming a gag: where the API
   * *did* write a client-safe `detail`, it still wins over every sentence
   * above. 117 of 131 `new AppError(...)` constructions carry one, and they are
   * the actionable ones — a 409 that explains the Punktemeldung has gone and
   * what to do instead must not be replaced by a generic conflict line.
   */
  it("never replaces a detail the API wrote", () => {
    const written = "Die Punktemeldung wurde bereits an die Ärztekammer übermittelt.";
    for (const status of [404, 409, 422, 429, 500]) {
      expect(
        describeError(failure(status, written), de.error.generic),
        `a ${status} carrying the API's own detail had it overwritten`,
      ).toBe(written);
    }
  });

  /*
   * `isRetryable` is the affordance half — Package B deferred the
   * retryable/permanent split to here because deciding what an error *is* is
   * this file's job, not a state machine's. A screen offering "Erneut
   * versuchen" on a 404 is §9.2: a control that can only produce the same
   * error.
   */
  it("says which failures are worth offering a retry control for", () => {
    for (const error of [failure(429), failure(500), failure(502), OFFLINE, TIMEOUT]) {
      expect(isRetryable(error)).toBe(true);
    }
    for (const error of [failure(400), failure(404), failure(409), failure(422)]) {
      expect(isRetryable(error)).toBe(false);
    }
    for (const error of [failure(401), failure(403)]) {
      expect(
        isRetryable(error),
        "a refusal is not retryable — that is P225-05's whole point",
      ).toBe(false);
    }
  });
});
