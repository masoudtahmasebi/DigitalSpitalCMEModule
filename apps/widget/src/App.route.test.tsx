/**
 * That the widget actually *uses* its address (P82-04).
 *
 * ## Why this file exists separately from `route.test.ts`
 *
 * `route.test.ts` proves `encode` and `decode` agree with each other. It would
 * be exactly as green on a widget that never called either — which is what the
 * admin console shipped for nine phases: a routes module with a full
 * round-trip suite, and an address bar that never moved (CLAUDE.md §9.7, and
 * the P42-01 incident it names).
 *
 * So the properties asserted here are the wiring, and each is one third of the
 * reported defect:
 *
 *   * a fragment on load opens that section — *"i refresh … and it goes to the
 *     main page of the course"*;
 *   * navigating writes the fragment — without which there is nothing to
 *     refresh into, and nothing to send anybody;
 *   * `hashchange` moves the screen — the browser's Back button.
 *
 * ## The ambient store
 *
 * jsdom's URL is shared between cases in a file and does not reset itself.
 * P42-01 hit exactly this and it surfaced as an unrelated assertion failing;
 * `localStorage` had already taught it in P22-08. Every case sets the hash it
 * wants and `afterEach` clears it — §9.8's second half.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";

const COURSE_SLUG = "adhs-akademie-adult";
const VIDEO_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const QUIZ_ID = "aaaaaaaa-0000-4000-8000-000000000002";

function course(): CourseDetail {
  return {
    id: "course-1",
    slug: COURSE_SLUG,
    title: "ADHS Akademie adult",
    description: null,
    heroImageUrl: null,
    deliveryType: "on_demand",
    thema: [],
    altersgruppe: [],
    cmePoints: 4,
    cmeCategory: "D",
    moduleCount: 1,
    totalDurationSec: 600,
    enrolment: null,
    learningObjectives: [],
    targetAudience: null,
    vnr: null,
    accreditationBody: null,
    organizer: null,
    eventLocation: null,
    validFrom: null,
    validTo: null,
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    experts: [],
    modules: [
      {
        id: "m1",
        ordinal: 0,
        title: "Modul 1 – Grundlagen",
        subtitle: null,
        chapters: [
          {
            id: "c1",
            ordinal: 0,
            title: "Kapitel 1",
            contents: [
              {
                id: VIDEO_ID,
                ordinal: 0,
                kind: "video",
                title: "Grundlagen",
                durationSec: 600,
                mimeType: null,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as CourseDetail;
}

function enrolmentState(overrides: Partial<EnrolmentState> = {}): EnrolmentState {
  const progress = {
    status: "in_progress" as const,
    completedCount: 0,
    totalCount: 1,
    percent: 0,
  };
  return {
    enrolmentId: "e1",
    courseSlug: COURSE_SLUG,
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    achievedWatchPercent: 0,
    quizPassed: false,
    evaluationSubmitted: false,
    efnPresent: false,
    courseComplete: false,
    complete: false,
    outstanding: ["watch", "quiz"],
    outstandingForCourse: ["watch", "quiz"],
    completedAt: null,
    courseCompletedAt: null,
    resumeContentId: null,
    progress,
    moduleCompletion: { completed: 0, total: 1 },
    modules: [
      {
        id: "m1",
        gate: "available",
        progress,
        chapters: [
          {
            id: "c1",
            gate: "available",
            progress,
            contents: [{ id: VIDEO_ID, gate: "available", progress }],
          },
        ],
      },
    ],
    ...overrides,
  } as unknown as EnrolmentState;
}

/**
 * The enrolment `open-at="certify"` exists for: the Fortbildung is done and the
 * CME point is not claimed. `evaluationSubmitted` is true so the intent lands
 * on the Punktemeldung directly rather than on the Evaluationsbogen first —
 * both routes are exercised below.
 */
function finishedUncertified(overrides: Partial<EnrolmentState> = {}): EnrolmentState {
  return enrolmentState({
    courseComplete: true,
    complete: false,
    quizPassed: true,
    evaluationSubmitted: true,
    achievedWatchPercent: 100,
    outstanding: ["efn"],
    outstandingForCourse: [],
    ...overrides,
  } as Partial<EnrolmentState>);
}

/**
 * The lesson payload the player fetches once a content screen opens.
 *
 * Minimal on purpose: this file is about the address, and a lesson rich enough
 * to render the whole player would make every failure here ambiguous.
 */
function lesson(): unknown {
  return {
    id: VIDEO_ID,
    kind: "video",
    title: "Grundlagen",
    body: null,
    durationSec: 600,
    watchedPercent: 0,
    watchedSegments: [],
    seekCeilingSec: 0,
    lastPositionSec: 0,
    resumeAtSec: 0,
    sources: [],
    subtitles: [],
    poster: null,
  };
}

/**
 * What `/certificate` answers, for the `open-at="certificate"` case.
 *
 * The same reason `/evaluation` and `/materials` have shapes of their own: a
 * `CourseDetail` falling through to `CertificatePanel` gives it an undefined
 * `completedAt`, and `formatBerlinDate` throws on it inside render.
 *
 * Vitest reports that as an unhandled error **outside** any test, so the file
 * says "387 passed" and the run still fails — which is exactly how it surfaced,
 * one `waitFor` after the assertion that used to end the case before the panel
 * had rendered at all.
 */
function certificate(): unknown {
  return {
    participantName: "Dr. med. Beispiel",
    vnr: "2760000000000000000",
    completedAt: "2026-09-01T10:00:00Z",
    eventLocation: "Online",
    organizer: "DigitalSpital",
    creditSentence: "4 CME-Punkte, Kategorie D.",
  };
}

/** Whether the course's own first screen is mounted. */
function inOutline(): boolean {
  return screen.queryAllByText("ADHS Akademie adult").length > 0;
}

/**
 * Whether the player screen is mounted.
 *
 * By „Fortbildung pausieren", which only the player draws. "Zurück zur
 * Übersicht" would have been the obvious choice and is the wrong one: the
 * course shell draws its own, so the check would be true on every screen and
 * could never go red.
 */
function inPlayer(): boolean {
  return screen.queryAllByRole("button", { name: /Fortbildung pausieren/u }).length > 0;
}

/**
 * The name of the tab currently selected on the course overview.
 *
 * Read from `aria-selected` rather than from what the panel renders, because
 * three of the four tabs fetch something of their own and this file's `fetch`
 * stub answers every URL with the course. Asserting on panel content would make
 * these cases fail for a reason that has nothing to do with the address.
 */
function selectedTab(): string | undefined {
  const selected = screen.queryAllByRole("tab", { selected: true })[0];
  return selected?.textContent ?? undefined;
}

/**
 * The catalogue's own answer, for the two DEP-33 cases below.
 *
 * The `beforeEach` stub answers every unmatched URL with `course()`, which is a
 * `CourseDetail` — `CoursePanel` reads `items` off it and renders nothing. This
 * one recognises the list endpoint.
 */
function stubCatalogue(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const list = /\/courses(\?|$)/u.test(url);
      const body = list
        ? {
            items: [
              {
                ...(course() as unknown as Record<string, unknown>),
                enrolment: null,
              },
            ],
            total: 1,
            page: 1,
            perPage: 10,
            facets: { thema: [], altersgruppe: [] },
          }
        : url.includes("/materials")
          ? { groups: [] }
          : url.includes("/evaluation")
            ? { questions: [] }
            : url.includes("/contents/")
              ? lesson()
              : url.includes("/enrolment")
                ? enrolmentState()
                : course();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** The widget as a catalogue embed: no `course` attribute. */
function renderCatalogue() {
  return render(
    <App
      apiBase="https://api.test"
      projectSlug="medice-adhs"
      courseSlug=""
      getToken={async () => "token"}
    />,
  );
}

function renderApp(openAt?: "start" | "resume" | "certify" | "certificate") {
  return render(
    <App
      apiBase="https://api.test"
      projectSlug="medice-adhs"
      courseSlug={COURSE_SLUG}
      getToken={async () => "token"}
      openAt={openAt}
    />,
  );
}

/**
 * Answer `/enrolment` with this state instead of the default one.
 *
 * The `beforeEach` stub is shaped for a course nobody has finished, which is
 * the right default for a file about addresses and the wrong fixture for the
 * three cases below.
 */
function stubEnrolment(state: EnrolmentState): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      /*
       * `/evaluation` has to be answered with its own shape, unlike in the
       * cases above that never open it. Falling through to the course made
       * `EvaluationScreen` read `questions` off a `CourseDetail` and throw —
       * which vitest reports as an unhandled error *outside* any test, so the
       * file said "10 passed" and the run still failed.
       */
      const body = url.includes("/materials")
        ? { groups: [] }
        : url.includes("/evaluation")
          ? { questions: [] }
          : url.includes("/certificate")
            ? certificate()
            : url.includes("/contents/")
              ? lesson()
              : url.includes("/enrolment")
                ? state
                : course();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      /*
       * `/materials` before `/contents/`: the Mediathek tab fetches the whole
       * library in one call, and without a shape of its own `MediathekPanel`
       * receives a `CourseDetail` and throws. An empty library is the right
       * fixture here — these cases are about the address, and the panel having
       * rows or not is DEP-14's business.
       */
      const body = url.includes("/materials")
        ? { groups: [] }
        : url.includes("/contents/")
          ? lesson()
          : url.includes("/enrolment")
            ? enrolmentState()
            : course();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  /*
   * Unmount **first**, then clear the URL.
   *
   * The other order is a race this file lost while it was being written: a
   * component still mounted has a write-back effect that will run again, so
   * clearing the fragment and then letting the previous test's widget put its
   * own back leaves the next case starting on somebody else's address. It
   * showed up as one assertion failing only when the whole file ran — §9.8's
   * second half, and the same shape as the jsdom URL leak in P42-01.
   */
  cleanup();
  vi.unstubAllGlobals();
  // Every ambient store, not only the one that broke.
  window.history.replaceState(null, "", window.location.pathname);
  window.localStorage.clear();
});

describe("the learner's address", () => {
  it("opens the section named in the fragment, rather than the course overview", async () => {
    /*
     * The report: *"when i am in the course, and i refresh, the url is
     * …/medice/kurs/adhs-akademie-adult and it goes to the main page of the
     * course."* A reload is this — a fresh mount with a fragment already set.
     */
    window.history.replaceState(null, "", `#ds/inhalt/${VIDEO_ID}`);

    renderApp();

    await waitFor(
      () => {
        expect(inPlayer()).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it("writes the fragment as the learner moves between screens", async () => {
    /*
     * Driven from the player back to the outline rather than the other way
     * round, because "Zurück zur Übersicht" is a control this screen certainly
     * owns — and the direction does not matter to the property. What matters
     * is that the address follows the screen, which is what makes the reload
     * case above reachable in the first place.
     */
    window.history.replaceState(null, "", `#ds/inhalt/${VIDEO_ID}`);
    renderApp();

    await waitFor(() => {
      expect(inPlayer()).toBe(true);
    });

    /*
     * The course shell's button, and now the only one.
     *
     * The player used to draw a second with the same accessible name, forty
     * pixels below it and going to the same place; P191-01 removed it, because
     * the layout draws exactly one. This case is about the address moving when
     * the learner leaves the player, so any control that leaves it will do —
     * but the assertion stays, so a future change that removes the *last* one
     * fails here rather than leaving a player nobody can get out of.
     */
    const [back] = screen.getAllByRole("button", { name: "Zurück zur Übersicht" });
    expect(back, "nothing leaves the player any more").toBeDefined();
    fireEvent.click(back!);

    // The screen moved …
    await waitFor(() => {
      expect(inPlayer()).toBe(false);
    });
    // … and the address moved with it.
    await waitFor(() => {
      expect(window.location.hash).toBe("#ds");
    });
  });

  it("follows the browser's Back button", async () => {
    window.history.replaceState(null, "", `#ds/inhalt/${VIDEO_ID}`);
    renderApp();

    await waitFor(() => {
      expect(inPlayer()).toBe(true);
    });

    // What Back does: the fragment changes underneath, and `hashchange` fires.
    act(() => {
      window.history.replaceState(null, "", "#ds");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => {
      expect(inPlayer()).toBe(false);
    });
  });

  it("ignores a fragment that belongs to the host page", async () => {
    /*
     * `<ds-lms>` sits inside a customer's WordPress page. A theme's anchor must
     * not close the video a physician is watching — and, just as importantly,
     * the widget must not rewrite it.
     */
    window.history.replaceState(null, "", "#kontakt");
    renderApp();

    await waitFor(() => {
      expect(inOutline()).toBe(true);
    });

    /*
     * Settled, not merely rendered. Asserting the instant the outline appears
     * would pass whether or not the write-back effect later overwrites the
     * host's fragment — a check that cannot go red (§9.1).
     */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(window.location.hash).toBe("#kontakt");
  });

  /*
   * The tab row (P123-01).
   *
   * P82-04 gave the player, the evaluation and the Punktemeldung an address and
   * left the four tabs of the course overview as React state — so the Mediathek
   * was a place a physician could be standing in and could not reload into,
   * link to, or press Back out of. That is §9.8's three symptoms, and each of
   * them on its own reads as the browser being awkward.
   *
   * These are the wiring, not the grammar. `route.test.ts` would be just as
   * green with every line below deleted.
   */
  it("opens the tab named in the fragment", async () => {
    window.history.replaceState(null, "", "#ds/mediathek");
    renderApp();

    await waitFor(() => {
      expect(selectedTab()).toBe("Mediathek");
    });
  });

  it("writes the fragment when the learner changes tab", async () => {
    renderApp();
    await waitFor(() => {
      expect(inOutline()).toBe(true);
    });

    fireEvent.click(screen.getByRole("tab", { name: "Mediathek" }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#ds/mediathek");
    });
  });

  it("follows Back from one tab to another", async () => {
    window.history.replaceState(null, "", "#ds/zertifizierung");
    renderApp();

    await waitFor(() => {
      expect(selectedTab()).toBe("Zertifizierung");
    });

    act(() => {
      window.history.replaceState(null, "", "#ds");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => {
      expect(selectedTab()).toBe("Übersicht");
    });
  });
});

/*
 * P168-04. `open-at="certify"`, which is the catalogue's **CME-Punkte geltend
 * machen** arriving as an attribute.
 *
 * It belongs in this file rather than beside the card, because the card's own
 * test proves it *asks* — `onOpen("k1", "certify")` — and would be exactly as
 * green if nothing acted on the word. That is §9.7: name the caller, and test
 * the wiring separately from the thing being wired.
 *
 * The intent is a request. The server's `courseComplete` decides whether it is
 * granted, so the last case is the one that keeps this from being a way past
 * the gate.
 */
describe("opening a course straight on the Punktemeldung", () => {
  it("lands on the Punktemeldung when the course is finished and unclaimed", async () => {
    stubEnrolment(finishedUncertified());

    renderApp("certify");

    await waitFor(() => {
      expect(window.location.hash).toBe("#ds/punktemeldung");
    });
  });

  it("takes the Evaluationsbogen first when it is still outstanding", async () => {
    // The API refuses a completion without one, so going straight to the EFN
    // field would be a refusal arriving after the personal data.
    stubEnrolment(finishedUncertified({ evaluationSubmitted: false }));

    renderApp("certify");

    await waitFor(() => {
      expect(window.location.hash).toBe("#ds/evaluation");
    });
  });

  it("ignores the intent on a course the server has not finished", async () => {
    /*
     * A stale card, a bookmarked attribute, or somebody typing it. The
     * Punktemeldung would refuse the completion, and a form that cannot be
     * submitted is worse than no button (§9.2) — so the course opens on its own
     * page instead.
     */
    stubEnrolment(enrolmentState());

    renderApp("certify");

    /*
     * Waiting for something only the **loaded** outline draws, and not with
     * `waitFor`. Both of the obvious versions are green on the broken code:
     *
     *   * `inOutline()` reads the course title, which the shell draws over the
     *     player, the exam and the Evaluationsbogen as well;
     *   * `waitFor(() => expect(selectedTab()).toBe("Übersicht"))` passes on the
     *     first tick, before the enrolment has even arrived — it asserts the
     *     screen the widget starts on, not the screen it settles on.
     *
     * The progress card's module sentence is rendered from `EnrolmentState`, so
     * finding it proves the fetch resolved and the intent had its chance. Both
     * were watched to go red with the `courseComplete` guard removed.
     *
     * It was the card's watch-percentage line until DEP-32 deleted that line,
     * and this case failed the moment it went — which is the suite noticing a
     * settle signal had become unreachable rather than silently waiting on
     * nothing.
     */
    await screen.findByText(/von 1 Modul abgeschlossen/u);

    expect(selectedTab()).toBe("Übersicht");
    expect(window.location.hash).not.toContain("punktemeldung");
    expect(window.location.hash).not.toContain("evaluation");
  });
});

/*
 * DEP-33. Zurück zur Übersicht changes the address as well as the screen.
 *
 * `route.test.ts` proves `clearCourseFragment` removes our fragment and leaves
 * a host page's alone. It would pass unchanged on a widget that never called it
 * — which is exactly the shape this file exists for (§9.7), and exactly the
 * defect: the catalogue rendered, the URL did not move, and a reload went back
 * into the course.
 */
describe("opening a course from the catalogue (P203)", () => {
  it("puts the course in the address the moment it opens", async () => {
    /*
     * The client, with the address bar in the screenshot: they clicked a course
     * on the WordPress page and the URL stayed at
     * `…/dscme/` — the embed's own address, naming no course.
     *
     * The cause is a `useRef` used as an effect guard. `addressApplied` is set
     * by the effect that *reads* the fragment, and the effect that *writes* it
     * returns early while the flag is false. A ref does not re-render and is
     * not a dependency, so once the read effect flips it, the write effect has
     * no reason to run again: `screen`, `tab` and `addressCourseSlug` are all
     * unchanged since mount.
     *
     * So a learner who opens a course and stays on Übersicht never gets an
     * address — and one who clicks a tab does, which is why every earlier
     * report of this was about a deeper screen and looked like it worked.
     */
    stubCatalogue();
    window.history.replaceState(null, "", "");

    renderCatalogue();

    // Open the first course from the list.
    const open = await screen.findByRole("button", {
      name: /Zur Fortbildung|Fortbildung ansehen/u,
    });
    fireEvent.click(open);

    await waitFor(() => {
      expect(inOutline()).toBe(true);
    });

    // Nothing else is touched — no tab clicked, no module opened.
    await waitFor(() => {
      expect(
        window.location.hash,
        "the course was opened and the address never named it",
      ).toBe(`#ds/kurs/${COURSE_SLUG}`);
    });
  });
});

describe("returning to the catalogue", () => {
  it("clears the course fragment, so a reload lands on the list", async () => {
    stubCatalogue();
    window.history.replaceState(null, "", `#ds/kurs/${COURSE_SLUG}/referenten`);

    renderCatalogue();

    // The fragment named a course, so the widget opens that course.
    await waitFor(() => {
      expect(selectedTab()).toBe("Experten/Referenten");
    });

    fireEvent.click(screen.getByRole("button", { name: /Zurück zur Übersicht/u }));

    await waitFor(() => {
      expect(window.location.hash).toBe("");
    });
  });

  /**
   * The address must not name a course while the catalogue is on screen —
   * whatever put it there (DEP-43 / P226-01).
   *
   * ## What this test is, and what the other one is not
   *
   * The case above asserts the **outcome** of one click, and it passed on the
   * broken code roughly 98 times in 100. That is what made DEP-43 look like a
   * flake: a single run is a coin weighted 49:1.
   *
   * The defect was an **ordering** — `clearCourseFragment()` then
   * `setSelected(undefined)` — and `Loaded`'s address effect writes whenever
   * the hash is empty **or** one of ours, with empty passing the test. A
   * pending passive effect from an earlier commit, flushed after the clear,
   * put the course fragment back. Proven by spying on `history.replaceState`:
   *
   *     #ds/kurs/adhs-akademie-adult        <- the address effect
   *     === clicking ===
   *     /                                   <- clearCourseFragment
   *     #ds/kurs/adhs-akademie-adult/referenten   <- the address effect again
   *
   * ## Why this one is deterministic and that one cannot be
   *
   * Reproducing the *race* needs a commit whose effects have not flushed when
   * the click lands, and nothing in a test can schedule that: two
   * `fireEvent`s in one tick do not do it, because testing-library flushes
   * between them (tried, and it did not reproduce).
   *
   * So this asserts the **invariant the fix installs** instead, which is the
   * property that makes the race impossible rather than unlikely: *on any
   * commit where no course is selected, a course fragment is removed.* The
   * `replaceState` below is exactly what the late effect did, and the
   * `rerender` is the commit — the fix has no dependency array, so every
   * commit enforces it.
   *
   * On the ordered version nothing re-clears, and this goes red every time.
   */
  it("takes the fragment off again if anything puts it back", async () => {
    stubCatalogue();
    window.history.replaceState(null, "", `#ds/kurs/${COURSE_SLUG}/referenten`);

    const view = renderCatalogue();
    await waitFor(() => {
      expect(selectedTab()).toBe("Experten/Referenten");
    });

    fireEvent.click(screen.getByRole("button", { name: /Zurück zur Übersicht/u }));
    await waitFor(() => {
      expect(window.location.hash).toBe("");
    });

    // What the racing effect did, done deliberately.
    window.history.replaceState(null, "", `#ds/kurs/${COURSE_SLUG}/referenten`);
    view.rerender(
      <App
        apiBase="https://api.test"
        projectSlug="medice-adhs"
        courseSlug=""
        getToken={async () => "token"}
      />,
    );

    await waitFor(() => {
      expect(
        window.location.hash,
        "a course fragment survived a commit on which the catalogue was the " +
          "screen — so whatever writes one wins, and a reload reopens a course " +
          "the learner has left",
      ).toBe("");
    });
  });

  it("still shows the catalogue, not just a cleared URL", async () => {
    // The other half: clearing the address without leaving the course would be
    // the same defect facing the other way.
    stubCatalogue();
    window.history.replaceState(null, "", `#ds/kurs/${COURSE_SLUG}`);

    renderCatalogue();
    await waitFor(() => {
      expect(inOutline()).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: /Zurück zur Übersicht/u }));

    /*
     * Not "no tabs": the catalogue has its own two (On Demand / Weitere), which
     * is what the first version of this assertion tripped over. The course's
     * tab row is what must be gone, and Zertifizierung appears on no other
     * screen.
     */
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: "Zertifizierung" })).toBeNull();
    });
    expect(screen.getAllByRole("tab", { name: /On Demand/u }).length).toBeGreaterThan(0);
  });
});

/*
 * P176-02. `open-at="certificate"` — the catalogue's finished card.
 *
 * The card says "Abgeschlossen – Teilnahmebescheinigung verfügbar", and the
 * client asked where the document actually is. It is on the Zertifizierung tab,
 * so that is where the intent lands — and, like `certify`, it is a request the
 * server's own answer grants or refuses.
 */
/*
 * §9.7 — name the caller (P195-04).
 *
 * `ModuleSidebar`, `CourseHeader`, `StickyProgress` and `QuizScreen` each have
 * their own tests for the three states, and every one of them would stay green
 * on an `App` that never passed the prop. The rule that decides *when* the
 * certificate is offered lives in `App`, so it needs a case that drives `App`.
 *
 * The pair is deliberate. Without the second, a component that offered the
 * download unconditionally would pass the first.
 */
describe("the Punktemeldung step's third state, wired", () => {
  it("offers the certificate on the course page once the enrolment is certified", async () => {
    stubEnrolment(
      finishedUncertified({
        complete: true,
        completedAt: "2026-09-01T10:00:00Z",
        outstanding: [],
      } as Partial<EnrolmentState>),
    );

    renderApp();

    await waitFor(() => {
      expect(
        screen.queryAllByRole("button", { name: /Zur Teilnahmebescheinigung/u }).length,
      ).toBeGreaterThan(0);
    });

    // And it has stopped inviting the act that is finished.
    expect(
      screen.queryAllByRole("button", { name: /CME-Punkte geltend machen/u }).length,
    ).toBe(0);

    /*
     * "Zur", never "herunterladen", on this screen (P176-02) — and this
     * assertion is load-bearing rather than stylistic. The card is a sibling of
     * the tab panel, so it renders *on* Zertifizierung, where
     * `CertificatePanel` draws a button with that exact name. A download here
     * would be two controls with one accessible name on one screen, which is
     * the collision that failed deploy 120's journey and the reason this ticket
     * exists.
     */
    expect(
      screen.queryAllByRole("button", {
        name: /Teilnahmebescheinigung herunterladen/u,
      }).length,
      "the course page promises a file the Zertifizierung tab already offers",
    ).toBe(0);
  });

  /*
   * The collision, asserted where it would actually happen (P195-05).
   *
   * `renderApp("certificate")` lands on the Zertifizierung tab, which mounts
   * `CertificatePanel` — and the progress card above the tab row is a sibling
   * of the panel, not a child, so both are on screen at once. Exactly one
   * control may carry the name.
   *
   * This is the case that would have failed deploy 120 in the browser, run
   * here in a second. It is not a duplicate of the label assertion above: that
   * one is about the course overview, this one is about the screen where the
   * second control lives.
   */
  it("draws exactly one Teilnahmebescheinigung herunterladen on the Zertifizierung tab", async () => {
    stubEnrolment(
      finishedUncertified({
        complete: true,
        completedAt: "2026-09-01T10:00:00Z",
        outstanding: [],
      } as Partial<EnrolmentState>),
    );

    renderApp("certificate");

    await waitFor(() => {
      expect(selectedTab()).toBe("Zertifizierung");
    });

    /*
     * Wait for the **panel**, then count — not `waitFor(count === 1)`, which is
     * the version this was written as and which could not go red.
     *
     * `waitFor` succeeds the moment its callback stops throwing, and there is a
     * window before `CertificateGate`'s fetch resolves where the card's control
     * is the only one on the page. So a second control appearing afterwards was
     * never observed: the assertion had already passed on the transient state.
     * Restoring the collision on purpose left it green, which is how this was
     * caught (§9.1 — a check that cannot go red is not a check).
     *
     * The VNR is the anchor because it is unique to the rendered certificate;
     * the heading "Teilnahmebescheinigung" is a substring of the button label
     * this case is counting.
     */
    await screen.findByText("2760000000000000000");

    expect(
      screen.queryAllByRole("button", {
        name: /Teilnahmebescheinigung herunterladen/u,
      }).length,
      "Playwright's strict mode refuses to guess between two, and so should a physician",
    ).toBe(1);
  });

  it("offers the claim, and no certificate, while the EFN is still outstanding", async () => {
    stubEnrolment(finishedUncertified());

    renderApp();

    await waitFor(() => {
      expect(
        screen.queryAllByRole("button", { name: /CME-Punkte geltend machen/u }).length,
      ).toBeGreaterThan(0);
    });

    /*
     * The client's rule, in the direction that costs something if it is wrong:
     * a download offered before the certificate exists is a control that can
     * only refuse (§9.2), and it would refuse *after* a physician had gone
     * looking for their document.
     */
    expect(
      screen.queryAllByRole("button", { name: /Zur Teilnahmebescheinigung/u }).length,
    ).toBe(0);
  });
});

describe("opening a course on its Teilnahmebescheinigung", () => {
  it("lands on the Zertifizierung tab when the course is certified", async () => {
    stubEnrolment(
      finishedUncertified({
        complete: true,
        completedAt: "2026-09-01T10:00:00Z",
        outstanding: [],
      } as Partial<EnrolmentState>),
    );

    renderApp("certificate");

    await waitFor(() => {
      expect(selectedTab()).toBe("Zertifizierung");
    });
    /*
     * Its own `waitFor`, as every other hash assertion in this file has.
     *
     * It used to be a bare `expect` after the wait above, and the two do not
     * settle together: the tab is React state and the fragment is written by a
     * following effect. On a loaded runner that effect had not run yet and the
     * case failed with `''` — the initial hash — which reads as "routing is
     * broken" rather than "the assertion was one tick early". It went red in CI
     * on a commit that touches neither the widget nor routing, and was green on
     * three consecutive local runs: §9.1's "two green runs is not proof".
     *
     * Deliberately **not** folded into the wait above. Asserting both in one
     * callback makes each retry require them simultaneously, and that version
     * failed here — the two are sequential states, and a wait that demands them
     * together is a different, stricter claim than either one.
     */
    await waitFor(() => {
      expect(window.location.hash).toBe("#ds/zertifizierung");
    });
  });

  it("ignores the intent when there is no certificate yet", async () => {
    /*
     * A finished-but-unclaimed course has no Bescheid, and the tab would draw
     * "noch nicht verfügbar" under a promise the card had just made. The
     * settle signal is the progress card's own line, for the reason spelled
     * out in the `certify` case above: a `waitFor` on the tab passes on the
     * first tick, before the enrolment has arrived.
     */
    stubEnrolment(finishedUncertified());

    renderApp("certificate");

    await screen.findByText(/Sie haben \d+ von \d+ Modul/u);

    expect(selectedTab()).toBe("Übersicht");
  });
});

/**
 * A failed exam is still open (P191-01).
 *
 * ## The report, at its own numbers
 *
 * A course with `pass_threshold_percent = 85`. The learner scored **60 %** and
 * the exam screen answered
 *
 * > Sie haben diese Lernerfolgskontrolle bereits mit 60 % bestanden. Sie kann
 * > nicht erneut abgelegt werden.
 *
 * three lines under its own panel reading **Bestehen 85 %** — and took away the
 * retry the API would have accepted, because `POST attempts` refuses only a
 * score that actually cleared the threshold.
 *
 * ## Why the test is here and not beside `passedQuizScore`
 *
 * `player.test.ts` covers the rule and would have stayed green through all of
 * this: the rule was not wrong, it was **not called**. `App.tsx` handed the raw
 * recorded score to a prop named `passedScorePercent`, so the presence of a
 * score was the pass. That is §9.7 exactly — a pure function tested in
 * isolation proves nothing about the screen unless something names the caller.
 *
 * So this drives `App` and asserts what a learner sees.
 */
describe("an exam that was sat and not passed", () => {
  /** The course, with the Lernerfolgskontrolle beside the video. */
  function courseWithExam(): CourseDetail {
    const base = course() as unknown as Record<string, unknown>;
    return {
      ...base,
      passThresholdPercent: 85,
      modules: [
        {
          id: "m1",
          ordinal: 0,
          title: "Modul 1",
          subtitle: null,
          chapters: [
            {
              id: "c1",
              ordinal: 0,
              title: "Kapitel 1",
              contents: [
                {
                  id: VIDEO_ID,
                  ordinal: 0,
                  kind: "video",
                  title: "Grundlagen",
                  durationSec: 600,
                  mimeType: null,
                },
                {
                  id: QUIZ_ID,
                  ordinal: 1,
                  kind: "quiz",
                  title: "Long Video question",
                  durationSec: null,
                  mimeType: null,
                },
              ],
            },
          ],
        },
      ],
    } as unknown as CourseDetail;
  }

  /** Sat, graded, and twenty-five points short of the course's 85. */
  function scoredSixty(): EnrolmentState {
    const progress = {
      status: "in_progress",
      completedCount: 0,
      totalCount: 1,
      percent: 0,
    };
    return enrolmentState({
      passThresholdPercent: 85,
      achievedWatchPercent: 100,
      modules: [
        {
          id: "m1",
          gate: "available",
          progress,
          chapters: [
            {
              id: "c1",
              gate: "available",
              progress,
              contents: [
                {
                  id: VIDEO_ID,
                  gate: "available",
                  progress: { ...progress, status: "completed" },
                },
                {
                  id: QUIZ_ID,
                  gate: "available",
                  progress: { ...progress, scorePercent: 60 },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Partial<EnrolmentState>);
  }

  function stubExam(state: EnrolmentState): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.includes("/quiz")
          ? {
              contentId: QUIZ_ID,
              passThresholdPercent: 85,
              attemptsUsed: 1,
              maxAttempts: null,
              questions: [],
            }
          : url.includes("/materials")
            ? { groups: [] }
            : url.includes("/evaluation")
              ? { questions: [] }
              : url.includes("/certificate")
                ? certificate()
                : url.includes("/contents/")
                  ? lesson()
                  : url.includes("/enrolment")
                    ? state
                    : courseWithExam();
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
  }

  /*
   * The claim that must not appear, matched on the German the screenshot
   * carried rather than on a test id: it is the sentence a physician read,
   * three lines under a panel saying **Bestehen 85 %**.
   */
  it("does not tell the learner they passed it", async () => {
    stubExam(scoredSixty());
    window.history.replaceState(null, "", `#ds/inhalt/${QUIZ_ID}`);
    renderApp();

    // The exam screen is actually mounted — without this the case would pass on
    // any screen that simply does not contain the sentence, which is every
    // other screen in the product (§9.1).
    await screen.findByText(/Bestehen/u);

    expect(screen.queryByText(/bereits.*bestanden/u)).toBeNull();
  });

  it("still offers the exam", async () => {
    stubExam(scoredSixty());
    window.history.replaceState(null, "", `#ds/inhalt/${QUIZ_ID}`);
    renderApp();

    await screen.findByText(/Bestehen/u);

    // The half the learner actually needed: a way back in. The API would have
    // accepted the attempt — 60 < 85 — and only the screen refused.
    expect(
      screen.queryAllByRole("button", { name: /Lernerfolgskontrolle|starten|beginnen/u })
        .length,
    ).toBeGreaterThan(0);
  });

  /**
   * The exam's surface is grey and the player's is white (DEP-41).
   *
   * Measured, not preferred — sampled inside the white card on the design
   * renders at 1400 px:
   *
   *   page-06, page-07 (player)                 left rgb(255,255,255)
   *   page-08/09/11/12 (Lernerfolgskontrolle)   left rgb(250,250,250)
   *   page-13 (Punktemeldung)                   left rgb(250,250,250)
   *
   * Asserted through `App` rather than on `CourseShell`, because the property is
   * the **wiring**: the shell takes a `surface` prop and would happily render
   * either value on either screen. A component test would pass on a build that
   * passed "muted" everywhere, which is the version of this that gets the player
   * wrong (§9.7).
   */
  describe("the exam and the player sit on different surfaces (DEP-41)", () => {
    /** The muted fill, as the shell spells it. Any element carrying it will do. */
    const muted = (): Element | null => document.querySelector(".bg-\\[\\#fafafa\\]");

    it("puts the Lernerfolgskontrolle on the grey one", async () => {
      stubExam(scoredSixty());
      window.history.replaceState(null, "", `#ds/inhalt/${QUIZ_ID}`);
      renderApp();

      // The exam is really mounted — otherwise this passes on any screen that
      // simply has no grey element, which is most of them (§9.1).
      await screen.findByText(/Bestehen/u);

      expect(muted()).not.toBeNull();
    });

    it("leaves the player white", async () => {
      stubExam(scoredSixty());
      window.history.replaceState(null, "", `#ds/inhalt/${VIDEO_ID}`);
      renderApp();

      await waitFor(() => expect(inPlayer()).toBe(true));

      expect(muted()).toBeNull();
    });
  });
});

/**
 * No band of the host page above the hero (P208-01).
 *
 * ## The report
 *
 * The client, twice: *"there is a not needed `mb-4` and `space-y-6 py-4` which
 * makes this different than the design"*, and then, with DevTools open on the
 * embed: *"why is `space-y-6` back on the div with parent of
 * `class="ds-lms-root"`?"*
 *
 * It was never back. P204-01 removed `py-4` and `mb-4` and **kept**
 * `space-y-6`, on the reasoning that it is the gap between the logo, the hero
 * and the content. That reasoning was a claim about a drawing I do not have —
 * the same PR said so under "Not verified" — and it missed something that needs
 * no drawing at all.
 *
 * ## What is actually wrong, and it is derivable
 *
 * `BrandLogo` returns `null` when the customer has set no logo. The course
 * detail wrapped it unconditionally:
 *
 *     <div className="space-y-6">
 *       <div className={CONTENT}><BrandLogo … /></div>
 *       <StickyMetaBar … />
 *
 * so with no logo that first child is an **empty div**, and `space-y-6` still
 * reserves 24 px above the hero — a band of the host page's background where
 * the layout has the hero meeting the page header.
 *
 * The catalogue already fixed exactly this and left the reason in a comment:
 * *"`BrandLogo` returns null when the customer has set no logo, but `px-4 pt-4`
 * inside a `space-y-6` does not — it left 40 px of nothing above the hero."*
 * The course detail never got the same guard. One screen learned the lesson and
 * its sibling did not, which is CLAUDE.md §9.11 in one file.
 *
 * ## Why this assertion and not a pixel one
 *
 * jsdom has no layout, so 24 px is not observable here. What is observable, and
 * is the whole defect, is that an **empty element** sits between the root and
 * the hero. A test asserting the absence of `space-y-6` in a class string would
 * pass on a rewrite that reintroduced the gap by another name (§9.7).
 */
describe("the top of the course detail", () => {
  it("puts no empty element above the hero when the customer has no logo", async () => {
    const { container } = renderApp();
    await screen.findByRole("heading", { name: course().title });

    const root = container.firstElementChild;
    expect(root).not.toBeNull();

    const empty = [...(root?.children ?? [])].filter(
      (child) => child.childElementCount === 0 && child.textContent === "",
    );

    expect(
      empty.map((child) => child.className),
      "an empty element above the hero is a band of the host page's background",
    ).toEqual([]);
  });
});

/**
 * A screen change puts the learner at the top (DEP-36, P210-02).
 *
 * Amruth's report: *"Opening a course from the course list navigates to the
 * course detail page with the scroll position in the middle of the page. The
 * top of the page (course header/hero section) is not visible on load."*
 *
 * The widget swaps screens in place, so nothing resets the host page's scroll.
 *
 * The second case is the one worth having. "Scroll to the top on mount" is the
 * obvious fix and is wrong: an embed can sit anywhere on a customer's page, and
 * yanking the reader upward because the widget finished loading is a defect
 * nobody reported only because the widget did not do it. So the absence is
 * asserted as deliberately as the presence.
 */
describe("the scroll position on a screen change", () => {
  it("goes to the top when a course is opened from the catalogue", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    stubCatalogue();
    renderCatalogue();

    const open = await screen.findByRole("button", {
      name: /Zur Fortbildung|Fortbildung ansehen/u,
    });
    expect(
      scrollTo,
      "the widget moved the page before anybody navigated",
    ).not.toHaveBeenCalled();

    fireEvent.click(open);
    await waitFor(() => {
      expect(inOutline()).toBe(true);
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
  });

  it("leaves the page alone when the widget merely loads", async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);

    renderApp();
    await screen.findByRole("heading", { name: course().title });

    /*
     * A sentinel rather than a bare absence assertion (P205-01's lesson): "not
     * called" a tick after render passes whether the rule holds or React simply
     * has not flushed. Driving a real navigation afterwards proves the spy was
     * wired and the effect does fire — so the absence above is about the rule.
     */
    expect(
      scrollTo,
      "the widget scrolled the host page on first render",
    ).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    await waitFor(() => {
      expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
    });
    expect(scrollTo, "a tab change is not a screen change").not.toHaveBeenCalled();
  });
});
