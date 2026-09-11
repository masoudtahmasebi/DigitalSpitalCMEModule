/**
 * The DocCheck preview, end to end through `App` (P213-01).
 *
 * ## Why these tests drive `App` and not `PreviewApp`
 *
 * §9.7. `PreviewApp` rendered directly would pass on a widget that never
 * reaches it — which is the property that actually matters here, because the
 * branch it hangs off (`signedIn === false`) is the one that used to render a
 * single sentence and must still do so for a project that has not opted in.
 * The call site is the thing under test; the component is reached through it.
 *
 * ## What is asserted, and why each one is a defect if it breaks
 *
 * * The preview is **the server's decision**. The only thing that opens it is a
 *   200 from `/preview/courses`; nothing about the host page does.
 * * A preview reader reaches **no participation route**. Every request the
 *   whole flow makes is asserted by path, so an enrolment added to a shared
 *   component later shows up here as a request that should not exist rather
 *   than as a 401 in somebody's console (§9.13 is about exactly what an API
 *   test cannot see).
 * * Reaching for participation produces **an answer**, not an error — the
 *   dialog, in German, naming the one action that changes the situation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "./App.js";
import { de } from "./locale/de.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const config = {
  apiBase: "https://api.example.test",
  projectSlug: "medice-adhs",
  /*
   * The catalogue embed, not the single-course one. `courseSlug: ""` is what
   * `element.ts` passes when the host page names no course, and it is the case
   * the client described — "they are able to see the course list".
   */
  courseSlug: "",
} as const;

const COURSE = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "adhs-erwachsene",
  title: "ADHS bei Erwachsenen",
  description: "Eine Fortbildung über ADHS im Erwachsenenalter.",
  heroImageUrl: null,
  deliveryType: "on_demand",
  thema: ["ADHS"],
  altersgruppe: ["Erwachsene"],
  cmePoints: 4,
  cmeCategory: "D",
  moduleCount: 5,
  totalDurationSec: 9000,
  enrolment: null,
};

const DETAIL = {
  ...COURSE,
  accreditationBody: "Ärztekammer Westfalen-Lippe",
  vnr: null,
  validFrom: null,
  validUntil: null,
  learningObjectives: ["ADHS im Erwachsenenalter erkennen"],
  requiredWatchPercent: 100,
  requiresEfn: true,
  experts: [],
  modules: [],
};

let requested: string[] = [];

/** The API of a project that has opted in. */
function previewPermitted(): void {
  requested = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(input.toString()).pathname;
    requested.push(path);

    if (path === "/preview/courses") {
      return json({
        items: [COURSE],
        facets: { thema: [{ value: "ADHS", count: 1 }], altersgruppe: [] },
        total: 1,
        page: 1,
        perPage: 10,
      });
    }
    if (path === `/preview/courses/${COURSE.slug}`) return json(DETAIL);
    if (path === "/branding") return json({});

    /*
     * Anything else is a failure of the test's subject, not of the fixture.
     * A 500 rather than a 404, so it cannot be mistaken for the API's own
     * "this project has no preview" answer while reading a failure.
     */
    return new Response("{}", { status: 500 });
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function renderPreview() {
  render(<App {...config} getToken={undefined} signedIn={false} signInUrl="/anmelden" />);
}

beforeEach(previewPermitted);

describe("a DocCheck visitor on a project that permits the preview", () => {
  it("reads the catalogue instead of a sign-in notice", async () => {
    renderPreview();

    expect(await screen.findByText(COURSE.title)).toBeTruthy();
    expect(screen.queryByText(de.signedOut.title)).toBeNull();
  });

  it("is told what this login covers before meeting its limit", async () => {
    renderPreview();
    await screen.findByText(COURSE.title);

    expect(screen.getByText(de.preview.noticeTitle)).toBeTruthy();
    expect(screen.getByText(de.preview.noticeMessage)).toBeTruthy();
  });

  it("can open a course and read its description", async () => {
    renderPreview();
    fireEvent.click(await screen.findByRole("button", { name: de.catalog.open }));

    expect(await screen.findByText(DETAIL.description)).toBeTruthy();
    expect(screen.getByText(DETAIL.learningObjectives[0] as string)).toBeTruthy();
  });

  it("reaches the preview routes and nothing that needs an identity", async () => {
    renderPreview();
    fireEvent.click(await screen.findByRole("button", { name: de.catalog.open }));
    await screen.findByText(DETAIL.description);

    /*
     * The assertion that would catch a participation call added later: no
     * `/courses/…`, no `/enrolment`, no `/completion`, no `/certificate`.
     * Written as a filter rather than an exact list because the branding fetch
     * is cached across renders and its presence depends on test order.
     */
    const forbidden = requested.filter((path) => !path.startsWith("/preview/"));
    expect(forbidden.every((path) => path === "/branding")).toBe(true);
  });
});

describe("reaching for participation", () => {
  async function openDialog() {
    renderPreview();
    fireEvent.click(await screen.findByRole("button", { name: de.catalog.open }));
    fireEvent.click(await screen.findByRole("button", { name: de.overview.start }));
  }

  it("answers with an explanation rather than an error", async () => {
    await openDialog();

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(de.preview.dialog.title);
    expect(dialog.textContent).toContain(de.preview.dialog.message);
  });

  it("names the one action that changes the situation, where the host said", async () => {
    await openDialog();

    const action = await screen.findByText(de.preview.dialog.action);
    expect(action.getAttribute("href")).toBe("/anmelden");
  });

  it("makes no request — there is none that could succeed", async () => {
    await openDialog();
    await screen.findByRole("dialog");

    expect(requested.some((path) => path.includes("enrolment"))).toBe(false);
  });

  it("closes back to the description the reader was in", async () => {
    await openDialog();
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByText(de.preview.dialog.dismiss));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(DETAIL.description)).toBeTruthy();
  });
});

describe("a project that has not opted in", () => {
  it("is unchanged: the sign-in notice, and no catalogue", async () => {
    requested = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requested.push(new URL(input.toString()).pathname);
      return new Response(JSON.stringify({ title: "not found" }), {
        status: 404,
        headers: { "content-type": "application/problem+json" },
      });
    });

    renderPreview();

    expect(await screen.findByText(de.signedOut.title)).toBeTruthy();
    expect(screen.queryByText(de.preview.noticeTitle)).toBeNull();
  });
});
