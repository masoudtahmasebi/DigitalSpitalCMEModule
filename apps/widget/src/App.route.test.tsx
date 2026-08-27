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

function enrolmentState(): EnrolmentState {
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
  } as unknown as EnrolmentState;
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

function renderApp() {
  return render(
    <App
      apiBase="https://api.test"
      projectSlug="medice-adhs"
      courseSlug={COURSE_SLUG}
      getToken={async () => "token"}
    />,
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
     * Exactly the player's own button.
     *
     * The course shell draws a second one with the same accessible name — its
     * arrow is `aria-hidden`, correctly, so a role-and-name query cannot tell
     * them apart. The two go to different places, and clicking the wrong one
     * would be testing a different control than this case is about.
     */
    const back = screen
      .getAllByRole("button", { name: "Zurück zur Übersicht" })
      .find((button) => button.textContent === "Zurück zur Übersicht");
    expect(back, "the player no longer draws its own back button").toBeDefined();
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
