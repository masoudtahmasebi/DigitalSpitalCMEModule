/**
 * The host half of the `<ds-lms>` contract (DEP-46).
 *
 * The widget's own suite proves it draws a back control when the host declares
 * one and dispatches `ds-lms:course-back` when it is pressed. Every one of
 * those cases would still be green on a portal that never set the attribute and
 * never listened — the control simply would not appear, and nothing on this
 * side would say so. That is §9.7 across a package boundary: the rule is
 * tested, the wiring is not, and the wiring is the product.
 *
 * So this file asserts the two things only this component can be wrong about —
 * that the attribute goes on a course mount and not on the catalogue, and that
 * the event reaches the navigation behind it.
 *
 * It cannot assert what the browser does with them, which is `journey.spec.ts`
 * and is a different instrument for a reason (§9.13).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { WidgetMount } from "./WidgetMount.js";
import type { PortalConfig } from "../config.js";

afterEach(cleanup);

const CONFIG: PortalConfig = {
  apiBase: "https://api.test",
  redirectUri: "https://portal.test/ds",
};

function mount(courseSlug: string | undefined, onBack = vi.fn()) {
  const view = render(
    <WidgetMount
      config={CONFIG}
      projectSlug="medice-adhs"
      courseSlug={courseSlug}
      openAt="start"
      tokenProvider={async () => "token"}
      onOpenCourse={vi.fn()}
      onBackToCatalogue={onBack}
    />,
  );
  const element = view.container.querySelector("ds-lms");
  if (element === null) throw new Error("the element did not render");
  return { element, onBack };
}

describe("what the portal declares to the widget", () => {
  it("says it handles back navigation on a course mount", () => {
    const { element } = mount("adhs-akademie-adult");
    expect(element.getAttribute("back-to-catalogue")).toBe("yes");
    expect(element.getAttribute("course")).toBe("adhs-akademie-adult");
  });

  it("says nothing of the sort on the catalogue mount", () => {
    /*
     * There is nowhere to go back *to* from the list, and the widget would
     * draw a control that returns to the screen already showing (§9.2). The
     * attribute travels with `course`, which is what keeps the two in step.
     */
    const { element } = mount(undefined);
    expect(element.getAttribute("back-to-catalogue")).toBeNull();
    expect(element.getAttribute("course")).toBeNull();
  });
});

describe("what the portal does with what the widget reports", () => {
  it("navigates when the widget reports the learner is leaving", () => {
    const { element, onBack } = mount("adhs-akademie-adult");

    element.dispatchEvent(
      new CustomEvent("ds-lms:course-back", {
        detail: { slug: "adhs-akademie-adult" },
        bubbles: true,
        composed: true,
      }),
    );

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("stops listening when the mount goes away", () => {
    /*
     * The listener is on the wrapper React owns for the whole mount, not on the
     * element, which is replaced on every navigation. A leaked listener would
     * navigate a portal that has moved on — and it is the kind of thing that
     * only shows up as a second history entry nobody can explain.
     */
    const { element, onBack } = mount("adhs-akademie-adult");
    cleanup();

    element.dispatchEvent(
      new CustomEvent("ds-lms:course-back", { detail: { slug: "x" }, bubbles: true }),
    );

    expect(onBack).not.toHaveBeenCalled();
  });
});
