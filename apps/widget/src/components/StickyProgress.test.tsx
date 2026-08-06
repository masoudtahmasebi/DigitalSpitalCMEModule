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

  it("offers 'starten' before anything is done and 'fortsetzen' after", () => {
    const { rerender } = render(
      <StickyProgress
        state={state({ progress: { completedCount: 0, totalCount: 11 } } as never)}
        onResume={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { name: "Fortbildung starten" })).toBeTruthy();

    rerender(<StickyProgress state={state()} onResume={() => undefined} />);
    expect(screen.getByRole("button", { name: "Fortbildung fortsetzen" })).toBeTruthy();
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
