/**
 * The catalogue's behaviour, not its appearance.
 *
 * Three properties worth a test, and they are all about **who decides what**:
 *
 * 1. Filtering and paging are sent to the server as a query. The list never
 *    narrows an array it already holds — with paging that would be wrong, and
 *    the facet counts are computed by the API under the rest of the selection,
 *    which a client holding one page could not reproduce.
 * 2. Changing a filter resets to page 1. The bug this prevents is silent: a
 *    learner on page 3 narrows a filter, the result set is now one page long,
 *    and they are looking at an empty page 3 being told nothing matches.
 * 3. A chip's ✕ and re-selecting the dropdown's placeholder are the same
 *    operation, because they write the same state.
 *
 * And one about the tab row, which the layout and the client's note on it make
 * a *function* switch rather than a delivery-type switch: `Weitere` asks for
 * every delivery type that is not on-demand, in one comma-separated parameter.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, CourseListResponse } from "@ds/sdk";
import { CourseList } from "./CourseList.js";

afterEach(cleanup);

function course(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${slug.padEnd(12, "0").slice(0, 12)}`,
    slug,
    title: `Kurs ${slug}`,
    description: null,
    heroImageUrl: null,
    deliveryType: "on_demand",
    thema: ["ADHS"],
    altersgruppe: ["Erwachsene"],
    cmePoints: 4,
    cmeCategory: "D",
    moduleCount: 5,
    totalDurationSec: 9000,
    enrolment: null,
    ...overrides,
  };
}

/** Records every query the component sends, and answers with `total` items. */
function stubClient(total = 1) {
  const queries: Record<string, unknown>[] = [];

  const listCourses = vi.fn(async (query: Record<string, unknown> = {}) => {
    queries.push(query);
    const page = Number(query["page"] ?? 1);
    const perPage = Number(query["perPage"] ?? 10);
    const start = (page - 1) * perPage;

    return {
      items: Array.from(
        { length: Math.max(0, Math.min(perPage, total - start)) },
        (_, i) => course(`k${start + i + 1}`),
      ),
      total,
      page,
      perPage,
      facets: {
        thema: [
          { value: "ADHS", count: 3 },
          { value: "Schlaf", count: 1 },
        ],
        altersgruppe: [{ value: "Erwachsene", count: 4 }],
      },
    } as unknown as CourseListResponse;
  });

  return { client: { listCourses } as unknown as ApiClient, queries };
}

describe("the catalogue asks the server, it does not filter locally", () => {
  it("sends the delivery type, the filters and the page as a query", async () => {
    const { client, queries } = stubClient(3);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);

    await screen.findByText("Kurs k1");

    fireEvent.change(screen.getByLabelText("Thema"), { target: { value: "Schlaf" } });
    await waitFor(() => expect(queries.length).toBeGreaterThan(1));

    expect(queries.at(-1)).toMatchObject({
      deliveryType: "on_demand",
      thema: "Schlaf",
      page: 1,
    });
  });

  it("asks the Weitere tab for every delivery type that is not on-demand", async () => {
    const { client, queries } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);
    await screen.findByText("Kurs k1");

    fireEvent.click(screen.getByRole("tab", { name: "Weitere" }));
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ deliveryType: "live,praesenz" }),
    );
  });

  it("does not carry a filter chosen on one tab into the other", async () => {
    // The two tabs are different catalogues. A Thema that exists among the
    // on-demand courses need not exist among the live ones, and silently
    // applying it there is how a learner lands on an empty tab that looks
    // broken rather than empty.
    const { client, queries } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);
    await screen.findByText("Kurs k1");

    fireEvent.change(screen.getByLabelText("Thema"), { target: { value: "Schlaf" } });
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ thema: "Schlaf" }));

    fireEvent.click(screen.getByRole("tab", { name: "Weitere" }));
    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ deliveryType: "live,praesenz" }),
    );
    expect(queries.at(-1)?.["thema"]).toBeUndefined();
  });

  it("returns to page 1 when a filter changes", async () => {
    // 25 items over 10 per page: three pages, so page 3 exists before the
    // filter narrows the set.
    const { client, queries } = stubClient(25);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);
    await screen.findByText("Kurs k1");

    fireEvent.click(screen.getByRole("button", { name: "Seite 3" }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ page: 3 }));

    fireEvent.change(screen.getByLabelText("Altersgruppe"), {
      target: { value: "Erwachsene" },
    });

    await waitFor(() =>
      expect(queries.at(-1)).toMatchObject({ altersgruppe: "Erwachsene", page: 1 }),
    );
  });
});

describe("the section says what it is, above the controls that narrow it", () => {
  /*
   * P106-01. The layout heads the list "On-Demand-Fortbildungen – volle
   * Flexibilität und jederzeit verfügbar"; the tab row that replaced that
   * heading (P58-02) kept the name and dropped the sentence, and for eight
   * phases the screen went straight from the hero into two dropdowns.
   *
   * Tested here rather than in the copy package, because a string in a locale
   * file is a rule nothing calls (CLAUDE.md §9.3): the caller is what makes it
   * a heading a physician reads, and this is the test that goes red if the
   * `description` prop stops being passed or stops being rendered.
   */
  it("heads the on-demand list with the layout's own sentence", async () => {
    const { client } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);
    await screen.findByText("Kurs k1");

    expect(
      screen.getByRole("heading", {
        name: "On-Demand-Fortbildungen – volle Flexibilität und jederzeit verfügbar",
      }),
    ).toBeTruthy();
  });

  it("says something different on the other tab, because it is a different offer", async () => {
    // "jederzeit verfügbar" is precisely what a live event is not, which is why
    // the line belongs to the section rather than sitting once above the tabs.
    const { client } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);
    await screen.findByText("Kurs k1");

    fireEvent.click(screen.getByRole("tab", { name: "Weitere" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "Live-Veranstaltungen und Präsenzfortbildungen – zu festen Terminen",
        }),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/jederzeit verfügbar/u)).toBeNull();
  });
});

describe("filters and their chips are one piece of state", () => {
  it("shows a chip for an active filter and clears it from the chip", async () => {
    const { client, queries } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);
    await screen.findByText("Kurs k1");

    fireEvent.change(screen.getByLabelText("Thema"), { target: { value: "ADHS" } });

    const chip = await screen.findByRole("button", { name: "Filter „ADHS“ entfernen" });
    fireEvent.click(chip);

    await waitFor(() => expect(queries.at(-1)?.["thema"]).toBeUndefined());
    // And the dropdown followed, rather than still showing a filter that is
    // no longer applied.
    expect((screen.getByLabelText("Thema") as HTMLSelectElement).value).toBe("");
  });
});

describe("the card carries the metadata line from the layout", () => {
  it("renders points, modules and duration", async () => {
    const { client } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);

    expect(
      await screen.findByText("4 CME Punkte | 5 Module | 2 Stunden 30 Minuten"),
    ).toBeDefined();
  });

  it("omits a part it has no value for rather than printing a zero", async () => {
    // "0 CME Punkte" would read as an accredited course worth nothing, which
    // is not the same as one whose accreditation is not recorded yet.
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { cmePoints: null, totalDurationSec: 0 })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    expect(await screen.findByText("5 Module")).toBeDefined();
  });
});

describe("empty states", () => {
  it("says so rather than rendering an empty list", async () => {
    const { client } = stubClient(0);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);

    expect(
      await screen.findByText(
        "Für die gewählten Filter stehen derzeit keine Fortbildungen zur Verfügung.",
      ),
    ).toBeDefined();
  });
});

describe("the call to action comes from the server, not from the card", () => {
  it("invites a learner who has not enrolled", async () => {
    const { client } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);

    expect(await screen.findByRole("button", { name: "Zur Fortbildung" })).toBeDefined();
  });

  it("offers to resume an unfinished enrolment", async () => {
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: { courseComplete: false, complete: false } })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Fortbildung fortsetzen" }),
    ).toBeDefined();
  });

  it("does not say 'fortsetzen' about a course already finished", async () => {
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: { courseComplete: true, complete: true } })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Fortbildung ansehen" }),
    ).toBeDefined();
  });

  /*
   * The state between the two (P52-05).
   *
   * A physician who has watched every video and passed the
   * Lernerfolgskontrolle, and has not yet filled in the Evaluationsbogen. The
   * card used to describe them as mid-course and offer "fortsetzen", because
   * it read `complete` — which waits for the paperwork. P51-01 fixed exactly
   * this on the course-detail screen and stopped there; the catalogue is what
   * a returning learner sees first.
   */
  const finishedNotCertified = { courseComplete: true, complete: false };

  it("does not offer to resume a course whose content is finished", async () => {
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: finishedNotCertified })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    // There is nothing left to resume: every video is watched and the quiz is
    // passed. Offering it is an instruction that leads nowhere.
    expect(
      await screen.findByRole("button", { name: "Fortbildung ansehen" }),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Fortbildung fortsetzen" })).toBeNull();
  });

  it("says the certification is still open, so there is a reason to go back", async () => {
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: finishedNotCertified })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    expect(await screen.findByText(/Zertifizierung noch offen/u)).toBeDefined();
  });

  it("says nothing about certification once the point is claimed", async () => {
    // The line exists to prompt an unfinished action. On a certified course it
    // would be noise on every card the learner has ever completed.
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: { courseComplete: true, complete: true } })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    await screen.findByRole("button", { name: "Fortbildung ansehen" });
    expect(screen.queryByText(/Zertifizierung noch offen/u)).toBeNull();
  });

  /*
   * P168-04. The line named a state; the card offered no way into it.
   *
   * The client, on the two cards side by side: *"in the list view still is
   * normal, while the one which has efn transmittal has a weird view, why not a
   * new button to go the needed layout?"* — one card carried a sentence with
   * nothing to press, and the finished one carried nothing at all.
   */
  it("offers the way to the Punktemeldung, with the intent that lands there", async () => {
    const onOpen = vi.fn();
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: finishedNotCertified })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "CME-Punkte geltend machen" }),
    );

    expect(onOpen).toHaveBeenCalledWith("k1", "certify");
  });

  it("does not offer it on a course nobody has finished", async () => {
    const { client } = stubClient(1);
    render(<CourseList client={client} branding={{}} onOpen={() => {}} />);

    await screen.findByRole("button", { name: "Zur Fortbildung" });
    expect(
      screen.queryByRole("button", { name: "CME-Punkte geltend machen" }),
    ).toBeNull();
  });

  it("tells a certified course apart from one nobody has opened", async () => {
    // It used to differ by one word in a button label, which is not a
    // difference anybody scanning a list of cards will see.
    const listCourses = vi.fn(async () => ({
      items: [course("k1", { enrolment: { courseComplete: true, complete: true } })],
      total: 1,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    }));

    render(
      <CourseList
        client={{ listCourses } as unknown as ApiClient}
        branding={{}}
        onOpen={() => {}}
      />,
    );

    expect(await screen.findByText(/Teilnahmebescheinigung verfügbar/u)).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "CME-Punkte geltend machen" }),
    ).toBeNull();
  });
});
