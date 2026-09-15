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

import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@ds/sdk";
import { announceable, describeError, isRetryable, toastPublisher } from "./api.js";
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

/**
 * The 403 sentence, verified where the review asked: **every screen, and both
 * locales** (P225-08).
 *
 * P225-05 changed one branch of one function. The claim that followed — "this
 * reaches every inline error channel in the console, because all of them call
 * this function" — is the kind §11 exists to stop: fluent, plausible, and
 * asserted by nothing. And the console ships in two languages, so a fix that is
 * right in German and falls back in English is half a fix that nothing would
 * report, because `overlay` answers a missing key with the German string and no
 * check has ever said so (§9.1, a fallback that hides its own absence).
 *
 * So: the wiring, the coverage, and the other language — each as an
 * observation rather than an argument.
 */
describe("the refusal sentence, across screens and across languages", () => {
  it("is the table's string and not a literal, which is what makes it translatable", () => {
    /*
     * The property the English case below depends on. `describeError` reads
     * `de.error.forbidden` from the resolved table — `de.ts` exports German or
     * the English overlay depending on `currentLanguage()` — so if this
     * returned a hard-coded sentence it would be German for ever and the next
     * test would be measuring nothing.
     */
    expect(describeError(failure(403), de.error.generic)).toContain(de.error.forbidden);
    expect(describeError(failure(403), de.error.generic)).not.toContain(de.error.generic);
  });

  it("is English when the console is, and is not the German fallback", async () => {
    /*
     * The observation, not the argument. `de.ts` resolves the table **at module
     * load** from `localStorage`, so this sets the language first and then
     * imports both modules fresh — which is the only way to see what an
     * operator who clicked EN actually gets.
     *
     * `vi.resetModules()` before *and* the ambient store cleared after: §9.8,
     * state that outlives a test is a failure attributed to the wrong code, and
     * `localStorage` has already taught this project that lesson once (P22-08).
     */
    window.localStorage.setItem("ds-admin-language", "en");
    vi.resetModules();
    try {
      const { describeError: describeEn } = await import("./api.js");
      const { de: table } = await import("./locale/de.js");
      /*
       * The failure has to be built from the **freshly imported** `ApiError`.
       *
       * `isForbidden` is `error instanceof ApiError && …`, and `resetModules`
       * gives the re-imported chain a different class object — so a failure
       * made by this file's top-level `failure()` fails the `instanceof`,
       * `describeError` falls through to the generic, and the assertion below
       * reads *"expected 'Please try again later.' to contain 'Your account is
       * not permitted…'"*.
       *
       * Which is exactly the sentence a defect in the product would produce.
       * The first run of this test showed it, and the honest reading took
       * checking `hasStatus` rather than believing the message: a test artefact
       * dressed as the bug the test was written to find (§11.1 — no causal
       * claim without a command).
       */
      const { ApiError: FreshApiError } = await import("@ds/sdk");
      const refusal = new FreshApiError(
        { type: "about:blank", title: "Failure", status: 403 } as never,
        new Response(null, { status: 403 }),
      );

      const sentence = describeEn(refusal, table.error.generic);

      expect(table.error.forbidden).toBe(
        "Your account is not permitted to do this. Please contact your administration.",
      );
      expect(sentence).toContain(table.error.forbidden);
      // The half that would otherwise pass silently: `overlay` answers a
      // missing key with German, so an untranslated `error.forbidden` would
      // still "contain" the table's value and still be German on screen.
      expect(
        sentence,
        "the refusal fell back to German on an English console",
      ).not.toContain("Ihr Konto");
    } finally {
      window.localStorage.clear();
      vi.resetModules();
    }
  });

  it("says a different thing when a whole screen is refused, and says it once", () => {
    /*
     * Two refusals, two scopes, and the review asked whether the change is
     * global. It is, and this is the boundary of what it changed.
     *
     * `describeError` answers a refused **action** inside a screen the operator
     * is legitimately in. Seven screens — Certificates, Learners, EivQueue,
     * PlatformEiv, Customers, StaffAccounts and `App.tsx`'s course workspace —
     * additionally catch a 403 on their **mount-time read** and replace
     * themselves with `de.auth.forbidden`, which is a different sentence for a
     * different thing.
     *
     * Asserted by reading the sources, because the property is "no screen
     * invented its own wording", and eight screens agreeing is not observable
     * from any one of them. A new screen that writes its own refusal sentence
     * fails here.
     *
     * `import.meta.glob` rather than `node:fs`: this app compiles against
     * `["ES2022", "DOM", "DOM.Iterable"]` with only `vite/client` types, so a
     * filesystem read does not typecheck here — which is the tsconfig being
     * right about what a browser app may do. The first version used
     * `readdir`/`readFile`, passed under vitest and failed `pnpm typecheck`
     * with four TS2307/TS2591 errors.
     */
    const sources = import.meta.glob("./components/*.tsx", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;

    const screenLevel: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (path.endsWith(".test.tsx")) continue;
      if (!source.includes("isForbidden")) continue;
      screenLevel.push(path);
      expect(
        source,
        `${path} catches a 403 on mount and does not render de.auth.forbidden — ` +
          "either it invented its own wording for a refused screen, or it is " +
          "using the action-level sentence for a screen-level refusal",
      ).toContain("de.auth.forbidden");
    }

    expect(
      screenLevel.length,
      "no component handles a screen-level 403, so this test is asserting nothing",
    ).toBeGreaterThanOrEqual(6);

    // And the boundary itself: the two sentences are genuinely different, so
    // the distinction above is a distinction and not two names for one string.
    expect(de.auth.forbidden).not.toBe(de.error.forbidden);
  });
});

/**
 * The expected-404 allowlist, read as a boundary rather than as a convenience
 * (P225-09).
 *
 * The review asked for this explicitly, and it is the right question to ask of
 * anything shaped like an allowlist. The answer has two halves and the second
 * is the one with teeth.
 *
 * ## What it is, and what it is not
 *
 * `ANSWERS_WITH_NOT_FOUND` suppresses **a toast**. It is not an authorisation
 * decision, it does not reach the API, and it cannot make any request succeed
 * that would otherwise fail. The only thing an entry can do is make the console
 * quieter — never more permissive. So the risk it carries is **masking a real
 * failure**, not granting anything, and the failure mode to guard is an entry
 * added for a route whose 404 is actually a refusal.
 *
 * That matters here more than it would elsewhere, because of §9.6: on a
 * tenant-scoped table an RLS-hidden row and an absent row are the same 404. A
 * future entry for such a route would turn "you are looking at the wrong
 * tenant" into silence. Which is why the table is keyed by **route**, is one
 * entry long, and every entry carries the sentence saying why.
 *
 * ## The property that actually keeps it safe
 *
 * **The error is re-thrown unconditionally.** Suppression changes what is
 * *announced* and never what is *thrown*, so every component's own `catch`
 * behaves exactly as it did before the net existed — including the ones that
 * treat a 404 as an answer and the ones that do not. If the `Proxy` ever
 * swallowed a suppressed rejection, a screen would resolve with stale data and
 * no message at all, which is strictly worse than the toast this suppresses.
 *
 * Nothing asserted that until now.
 */
describe("the expected-404 allowlist as a boundary", () => {
  it("suppresses the toast for the one route whose 404 is an answer, and nothing else", () => {
    // The entry itself, and its neighbours. `adminGetFont` 404s deliberately
    // when a project has never had a font — which is every customer today.
    expect(announceable("adminGetFont", 404)).toBe(false);

    // A 404 from anything else is still a failure and still announced: a course
    // opened from a stale link, a participant deleted in another tab.
    for (const method of [
      "adminListCourses",
      "adminGetCourse",
      "adminListParticipants",
      "adminGetCertificate",
      "adminListSubmissions",
    ]) {
      expect(announceable(method, 404), `a 404 from ${method} was silenced`).toBe(true);
    }

    // And the suppression is per **route**, not per status: the same route
    // failing for a real reason still speaks.
    for (const status of [400, 409, 422, 500, 502, 503]) {
      expect(
        announceable("adminGetFont", status),
        `adminGetFont ${status} was silenced along with its 404`,
      ).toBe(true);
    }
  });

  it("never swallows the rejection it declines to announce", async () => {
    /*
     * The security-relevant half, and the one that was untested.
     *
     * Driven through the real client so the assertion is about the `Proxy` that
     * ships rather than about a re-description of it (§9.7). `fetch` is stubbed
     * to answer 404 on the font route; the call must still reject, with the
     * status intact, so `BrandingSettings`' own handler still runs and still
     * renders the empty upload form.
     */
    const original = globalThis.fetch;
    const published: string[] = [];
    const publisher = toastPublisher.current;
    toastPublisher.current = (text) => published.push(text);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "no font",
        }),
        { status: 404, headers: { "content-type": "application/problem+json" } },
      )) as typeof fetch;

    try {
      const { createAdminClient } = await import("./api.js");
      const client = createAdminClient(
        { apiBase: "http://api.invalid" } as never,
        "cust-1",
        () => undefined,
      );

      await expect(
        client.adminGetFont(),
        "the suppressed 404 was swallowed: the caller resolved instead of " +
          "rejecting, so the screen's own handler never ran and it renders " +
          "whatever it had before, with no message",
      ).rejects.toMatchObject({ problem: { status: 404 } });

      expect(
        published,
        "the font 404 raised a toast after all — this is the defect P225-04 fixed",
      ).toEqual([]);
    } finally {
      globalThis.fetch = original;
      toastPublisher.current = publisher;
    }
  });
});
