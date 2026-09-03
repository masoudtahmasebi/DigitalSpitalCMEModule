/**
 * The authoring tree, as a person meets it (P100-02).
 *
 * ## Why this file exists
 *
 * The most structurally complicated screen in the console had no component test
 * at all. The e2e journey authors a course, so the screen was not unverified —
 * but the journey takes twenty seconds and a browser, and it asserts that the
 * *flow* works rather than that the *screen* says what it means. Redesigning the
 * three nesting levels was therefore a change with no local gate, which is
 * CLAUDE.md §9.1: the work happened somewhere nothing could go red.
 *
 * ## What is actually under test
 *
 * Three properties, each of which was broken at some point in this ticket and
 * caught by hand rather than by a check:
 *
 * 1. **All three levels are on the screen at once.** Flattening a tree of
 *    bordered boxes into rows is a change that can silently drop a level —
 *    a mis-closed tag renders the module and eats its chapters. Nothing else
 *    in the suite would have noticed.
 * 2. **Each level is still an ordered list.** The reorder buttons are the
 *    accessible path (see this component's header) and they are meaningless if
 *    the thing they reorder stopped announcing itself as a sequence. Skin
 *    changes are exactly where list semantics get lost.
 * 3. **The deletion rule is stated once, and each locked row carries a marker
 *    that still names the reason.** This is P100-01's finding — the same
 *    118-character sentence rendered once per level — and it had no test.
 *
 * The client is a plain object rather than a mock proxy: a method the component
 * starts calling and this file does not provide should be a `TypeError` here,
 * not a silently recorded call that passes.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type {
  ApiClient,
  AuthoringChapter,
  AuthoringContent,
  AuthoringModule,
  CourseStructure,
} from "@ds/sdk";
import { CourseStructureEditor } from "./CourseStructure.js";
import { de } from "../locale/de.js";
import type * as MediaPreviewModule from "../media-preview.js";
import type * as MediaDurationModule from "../media-duration.js";

afterEach(cleanup);

function content(over: Partial<AuthoringContent> = {}): AuthoringContent {
  return {
    id: "c1",
    kind: "video",
    title: "Diagnostik im Erwachsenenalter",
    body: null,
    sources: [],
    posterUrl: null,
    captionsUrl: null,
    durationSec: 600,
    fileUrl: null,
    fileSize: null,
    mimeType: null,
    learnerRecords: 0,
    questionCount: null,
    ...over,
  };
}

function chapter(over: Partial<AuthoringChapter> = {}): AuthoringChapter {
  return { id: "k1", title: "Grundlagen", body: null, contents: [content()], ...over };
}

function module(over: Partial<AuthoringModule> = {}): AuthoringModule {
  return {
    id: "m1",
    title: "ADHS erkennen",
    subtitle: null,
    chapters: [chapter()],
    ...over,
  };
}

function structure(modules: readonly AuthoringModule[]): CourseStructure {
  return {
    courseSlug: "adhs-akademie-adult",
    title: "ADHS Akademie adult",
    modules: [...modules],
    experts: [],
  };
}

function mount(tree: CourseStructure) {
  const client = {
    adminGetStructure: vi.fn().mockResolvedValue(tree),
  } as unknown as ApiClient;

  render(
    <CourseStructureEditor
      client={client}
      courseSlug="adhs-akademie-adult"
      onEditQuiz={vi.fn()}
    />,
  );

  return client;
}

it("shows the module, its chapter and its content at the same time", async () => {
  mount(structure([module()]));

  // Not one of the three: the whole point of the tree is that an author can see
  // where a video sits without opening anything.
  expect(await screen.findByText("ADHS erkennen")).toBeTruthy();
  expect(screen.getByText("Grundlagen")).toBeTruthy();
  expect(screen.getByText("Diagnostik im Erwachsenenalter")).toBeTruthy();

  // And each is labelled by what it is, beside its own title.
  expect(screen.getByText(`${de.structure.module} 1`)).toBeTruthy();
  expect(screen.getByText(`${de.structure.chapter} 1`)).toBeTruthy();
  expect(screen.getByText(de.structure.kinds.video)).toBeTruthy();
});

it("keeps every level an ordered list, because the reorder buttons are the a11y path", async () => {
  mount(
    structure([
      module({
        chapters: [
          chapter({
            contents: [content(), content({ id: "c2", title: "Komorbiditäten" })],
          }),
        ],
      }),
    ]),
  );

  await screen.findByText("ADHS erkennen");

  // Modules, chapters, contents — three nested lists, and the innermost holds
  // the two contents as separate items rather than one run-together row.
  const lists = screen.getAllByRole("list");
  expect(lists.length).toBe(3);
  expect(screen.getAllByRole("listitem").length).toBe(4);
});

it("states the deletion rule once, however many rows are locked", async () => {
  mount(
    structure([
      module({
        chapters: [chapter({ contents: [content({ learnerRecords: 3 })] })],
      }),
    ]),
  );

  await screen.findByText("ADHS erkennen");

  // The rule, at the top of the screen, once — not once per level. Before
  // P100-01 this sentence appeared three times on exactly this tree, which is
  // what pushed every row to full width.
  expect(screen.getAllByText(de.structure.lockedRule).length).toBe(1);

  // All three levels are locked by that one record, and each says so in two
  // words rather than in the whole rule.
  expect(screen.getAllByText(de.structure.locked).length).toBe(3);

  // The reason is not lost — it is the marker's accessible name.
  expect(screen.getAllByLabelText(de.structure.lockedByRecords).length).toBe(3);
});

it("offers delete where nothing is recorded, and only there", async () => {
  mount(
    structure([
      module({
        id: "m1",
        title: "ADHS erkennen",
        chapters: [chapter({ contents: [content({ learnerRecords: 0 })] })],
      }),
      module({
        id: "m2",
        title: "ADHS behandeln",
        chapters: [
          chapter({ id: "k2", contents: [content({ id: "c2", learnerRecords: 1 })] }),
        ],
      }),
    ]),
  );

  // The title also appears in the move-to-module listbox, so wait on all of
  // them rather than asserting there is one.
  await screen.findAllByText("ADHS behandeln");

  /*
   * One deletable row, not three (migrated for P162-02).
   *
   * This asserted three: the module, its chapter and its content were all
   * offered, because the only question asked was "has a learner touched it".
   * Two of those three answered 500 — `ON DELETE RESTRICT` on
   * `chapters.module_id` and `contents.chapter_id` — so the assertion was
   * pinning a button whose only possible outcome was an internal error.
   *
   * Kept and re-aimed rather than deleted: what it is for is still "offered
   * exactly where it can work", and there are now two ways for it not to be.
   * The innermost row of the untouched branch is the one that can be deleted;
   * everything above it holds something, and the whole second branch holds a
   * learner record.
   */
  expect(screen.getAllByRole("button", { name: de.common.delete }).length).toBe(1);
  expect(screen.getAllByText(de.structure.locked).length).toBe(5);

  // And the two reasons are told apart, because they need different answers:
  // one is emptied by the author, the other can never be emptied at all.
  expect(
    screen.getAllByLabelText(
      de.structure.lockedByChildren(1, de.structure.childChapters(1)),
    ).length,
  ).toBe(1);
  expect(screen.getAllByLabelText(de.structure.lockedByRecords).length).toBe(3);
});

it("says a quiz has no questions on the row, before anybody opens it", async () => {
  // §9.2's mirror: a Lernerfolgskontrolle with no questions is one nobody can
  // pass, and the course cannot be completed. The row is where an author is
  // looking when they could still fix it.
  mount(
    structure([
      module({
        chapters: [
          chapter({
            contents: [
              content({
                id: "q1",
                kind: "quiz",
                title: "Abschlussprüfung",
                questionCount: 0,
              }),
            ],
          }),
        ],
      }),
    ]),
  );

  expect(await screen.findByText(de.structure.noQuestions)).toBeTruthy();
});

it("reports a failed load rather than an empty tree", async () => {
  const client = {
    adminGetStructure: vi.fn().mockRejectedValue(new Error("network")),
  } as unknown as ApiClient;

  render(
    <CourseStructureEditor
      client={client}
      courseSlug="adhs-akademie-adult"
      onEditQuiz={vi.fn()}
    />,
  );

  // "This course has no modules" and "we could not ask" are different facts,
  // and an author who deletes nothing because the screen looked empty is the
  // cost of confusing them (§9.6, one layer out).
  await waitFor(() => expect(screen.getByText(de.error.title)).toBeTruthy());
  expect(screen.queryByText(de.structure.empty)).toBeNull();
});

it("puts the chapter's move-to-module control only where there is another module", async () => {
  mount(structure([module()]));
  await screen.findByText("ADHS erkennen");
  expect(screen.queryByLabelText(de.structure.moveToModule)).toBeNull();

  cleanup();

  mount(
    structure([
      module(),
      module({ id: "m2", title: "ADHS behandeln", chapters: [chapter({ id: "k2" })] }),
    ]),
  );
  await screen.findAllByText("ADHS behandeln");

  const selects = screen.getAllByLabelText(de.structure.moveToModule);
  expect(selects.length).toBe(2);
  expect(within(selects[0] as HTMLElement).getAllByRole("option").length).toBe(2);
});

/*
 * The length probe's two failure causes (P161-03).
 *
 * Until P161-01 a video reused from the Mediathek in a second course was
 * refused by our own API, and this field answered "Das kommt bei Servern ohne
 * CORS-Freigabe … vor" — a confident sentence about a cause nobody observed,
 * pointing an author at an object-storage setting that was not the problem.
 *
 * Both mocks are needed for the pair to be distinguishable at all: with only
 * one of them the two paths collapse into whichever failure comes first, which
 * is the defect rather than the test.
 */
vi.mock("../media-preview.js", async () => {
  const actual = await vi.importActual<typeof MediaPreviewModule>("../media-preview.js");
  return { ...actual, readableUrl: vi.fn() };
});
vi.mock("../media-duration.js", async () => {
  const actual =
    await vi.importActual<typeof MediaDurationModule>("../media-duration.js");
  return { ...actual, probeDurationSec: vi.fn() };
});

const { readableUrl } = await import("../media-preview.js");
const { probeDurationSec } = await import("../media-duration.js");
const { MeasuredDuration } = await import("./CourseStructure.js");

function renderProbe(state: "idle" | "running" | "failed" | "unreadable" | number) {
  const onState = vi.fn();
  render(
    <MeasuredDuration
      id="dauer"
      client={{} as ApiClient}
      courseSlug="kurs-b"
      sources={[{ url: "s3://cust/courses/kurs-a/video-x.mp4", mimeType: "video/mp4" }]}
      value="0"
      state={state}
      onChange={vi.fn()}
      onState={onState}
    />,
  );
  return onState;
}

it("says the platform refused, not that the storage has no CORS rule", async () => {
  vi.mocked(readableUrl).mockResolvedValue(undefined);

  const onState = renderProbe("idle");
  await waitFor(() => expect(onState).toHaveBeenCalledWith("unreadable"));

  cleanup();
  renderProbe("unreadable");
  expect(screen.getByText(de.structure.durationUnreadable)).toBeTruthy();
  expect(screen.queryByText(de.structure.durationDetectFailed)).toBeNull();
  // The probe is never reached: there was no URL to probe.
  expect(probeDurationSec).not.toHaveBeenCalled();
});

it("still names the file when the browser reached it and could not read it", async () => {
  vi.mocked(readableUrl).mockResolvedValue("https://bucket.example/video-x.mp4");
  vi.mocked(probeDurationSec).mockResolvedValue(undefined);

  const onState = renderProbe("idle");
  await waitFor(() => expect(onState).toHaveBeenCalledWith("failed"));

  cleanup();
  renderProbe("failed");
  expect(screen.getByText(de.structure.durationDetectFailed)).toBeTruthy();
  expect(screen.queryByText(de.structure.durationUnreadable)).toBeNull();
});
