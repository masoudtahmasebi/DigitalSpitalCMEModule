/**
 * The floating progress module (P19-01).
 *
 * What is worth asserting here is not that it renders — it is that it stays a
 * *renderer*. Its numbers come from `EnrolmentState`, which only ever arrives
 * from the API, so the tests feed it states and check the arithmetic it does
 * on the way to the screen, including the ones a division would break on.
 *
 * The rest is disclosure behaviour: something that floats over a video has to
 * be closable, and by a keyboard as well as a thumb.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EnrolmentState } from "@ds/sdk";
import { StickyProgress } from "./StickyProgress.js";

afterEach(cleanup);

function state(overrides: Partial<EnrolmentState> = {}): EnrolmentState {
  return {
    courseSlug: "adhs-akademie-adult",
    cmePoints: 4,
    achievedWatchPercent: 40,
    requiredWatchPercent: 100,
    moduleCompletion: { completed: 2, total: 3 },
    progress: { completedCount: 4, totalCount: 11 },
    outstanding: [],
    completedAt: null,
    resumeContentId: null,
    resumeAtSec: 0,
    seekCeilingSec: null,
    ...overrides,
  } as unknown as EnrolmentState;
}

describe("StickyProgress", () => {
  it("is a button named by the whole sentence, not by the word Fortschritt", () => {
    render(<StickyProgress state={state()} onResume={undefined} />);

    // "Fortschritt" alone tells a screen-reader user nothing they did not
    // already suspect from a progress control.
    const button = screen.getByRole("button", {
      name: "Sie haben 2 von 3 Modulen abgeschlossen.",
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens onto the panel and closes again from the heading", () => {
    render(<StickyProgress state={state()} onResume={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByRole("region", { name: "Ihr Fortschritt" })).toBeTruthy();
    expect(screen.getByText("Sie haben 2 von 3 Modulen abgeschlossen.")).toBeTruthy();

    // The heading is the toggle — the layout draws no close control, and a
    // panel over a video that cannot be dismissed is worse than an extra role.
    fireEvent.click(screen.getByRole("button", { name: "Ihr Fortschritt" }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("closes on Escape and gives focus back to the control that opened it", () => {
    render(<StickyProgress state={state()} onResume={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.keyDown(document, { key: "Escape" });

    const reopened = screen.getByRole("button", { expanded: false });
    expect(reopened).toBe(document.activeElement);
  });

  /**
   * The label follows the server's `status`, not a completed count (P68-02).
   *
   * It followed `completedCount === 0`, and a physician who had watched half of
   * the first module and come back the next evening was offered **Fortbildung
   * starten** — an invitation to begin something they were in the middle of,
   * beside a panel reading "50 % der Videoinhalte angesehen". The middle case
   * below is the one that separates the two rules, and it is the ordinary one.
   */
  it("offers 'starten' only before anything is started", () => {
    const { rerender } = render(
      <StickyProgress
        state={state({
          progress: { status: "not_started", completedCount: 0, totalCount: 11 },
        } as never)}
        onResume={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { name: "Fortbildung starten" })).toBeTruthy();

    // Started, nothing finished — the case the old rule got wrong.
    rerender(
      <StickyProgress
        state={state({
          progress: { status: "in_progress", completedCount: 0, totalCount: 11 },
        } as never)}
        onResume={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Fortbildung fortsetzen" })).toBeTruthy();

    rerender(<StickyProgress state={state()} onResume={() => undefined} />);
    expect(screen.getByRole("button", { name: "Fortbildung fortsetzen" })).toBeTruthy();
  });

  /**
   * The open card's shape and its focus indicator (DEP-29).
   *
   * The report was "a visible rectangular border outline around the card,
   * where the design has clean rounded corners and none". Two things in this
   * component could draw one, and both were true at once, so both are asserted:
   *
   * 1. the card was `rounded-3xl` on all four corners, where every teal block
   *    in the layout — this card, the inline `ProgressPanel`, every tab, and
   *    the very button this opens from — squares its top-right;
   * 2. the heading carried `outline-none focus-visible:ring-2`, which cannot
   *    win against `styles.css`'s (0,2,0) `:focus-visible` floor, so the floor
   *    drew its own 2 px `--ds-accent` rectangle — dark blue, on teal, at the
   *    moment the card opens, because `closeRef.focus()` runs then.
   *
   * jsdom applies no cascade, so this cannot assert the painted result; what
   * it asserts is that the class list still expresses the intent, and
   * `scripts/check-focus-ring.mjs` holds the ordering the paint depends on.
   */
  it("draws the open card as the layout's teardrop, with no stray outline", () => {
    render(<StickyProgress state={state()} onResume={() => undefined} />);

    const closed = screen.getByRole("button", { expanded: false });
    // The shape the open card has to agree with — a disc with a square
    // top-right, at the other scale.
    expect(closed.className).toContain("rounded-full");
    expect(closed.className).toContain("rounded-tr-none");

    fireEvent.click(closed);

    const card = screen.getByRole("region", { name: "Ihr Fortschritt" });
    expect(card.className).toContain("rounded-[1.25rem]");
    expect(card.className).toContain("rounded-tr-none");
    expect(card.className.split(/\s+/u)).not.toContain("rounded-3xl");

    // The heading has to beat the floor rather than ask it to stand down: a
    // bare `outline-none` is (0,1,0) and loses wherever it sits in the file.
    const heading = screen.getByRole("button", { name: "Ihr Fortschritt" });
    expect(heading.className).toContain("focus-visible:outline-white");
    expect(heading.className.split(/\s+/u)).not.toContain("outline-none");
  });

  it("omits the action entirely when there is nowhere to resume to", () => {
    render(<StickyProgress state={state()} onResume={undefined} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    // Not a disabled button: a control that cannot do anything is a control
    // the layout does not draw.
    expect(screen.queryByRole("button", { name: /Fortbildung/ })).toBeNull();
  });

  it("calls back exactly once when the learner resumes", () => {
    const onResume = vi.fn();
    render(<StickyProgress state={state()} onResume={onResume} />);

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    fireEvent.click(screen.getByRole("button", { name: "Fortbildung fortsetzen" }));

    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("survives a course with no modules", () => {
    // `completed / total` is a division, and a course whose content has not
    // been authored yet has a total of zero. The ring must not be NaN, which
    // renders as a blank SVG attribute and silently draws nothing.
    const { container } = render(
      <StickyProgress
        state={state({ moduleCompletion: { completed: 0, total: 0 } } as never)}
        onResume={undefined}
      />,
    );

    for (const circle of container.querySelectorAll("circle")) {
      expect(circle.getAttribute("stroke-dasharray") ?? "").not.toContain("NaN");
    }
  });

  it("never draws more than a full ring, whatever the server said", () => {
    // Defensive rather than expected: the arc is drawn from a ratio and a
    // ratio above one would wrap the stroke back over itself, which reads as
    // *less* progress than a full ring.
    const { container } = render(
      <StickyProgress
        state={state({ moduleCompletion: { completed: 7, total: 3 } } as never)}
        onResume={undefined}
      />,
    );

    const arc = container.querySelectorAll("circle")[1];
    const [drawn, whole] = (arc?.getAttribute("stroke-dasharray") ?? "0 0")
      .split(" ")
      .map(Number);

    expect(drawn).toBeLessThanOrEqual(whole ?? 0);
  });
});
