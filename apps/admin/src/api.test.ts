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
import { announceable, describeError } from "./api.js";
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
