/**
 * A form with unsaved edits says so before the operator loses them (P234-01).
 *
 * ## The defect
 *
 * Nothing in the console guarded an in-progress edit. Clicking a navigation
 * link discarded it; so did a reload or a closed tab. Silently, every time —
 * `grep -rn "beforeunload" apps/admin/src` returned nothing.
 *
 * The worst instance is the project settings form: twenty-odd fields including
 * SMTP host, port, username, password and sender address. An operator part-way
 * through configuring a customer's mail who clicks **Fortbildungen** loses all
 * of it and is told nothing.
 *
 * ## Why the registry is tested rather than a form
 *
 * Because the property is about two things that never meet: a form declares it
 * is dirty, and the *navigation* — which knows nothing about that form — has to
 * refuse. A component test of either half alone would pass on a console where
 * the two were never wired together, which is §9.7's trap and the reason
 * `App.test.tsx` gets the second half of this.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { forgetUnsavedChanges, hasUnsavedChanges, useUnsavedChanges } from "./hooks.js";

afterEach(() => {
  cleanup();
  // §9.8: reset every ambient store, not only the one that broke. This one is
  // a module-level Set, which is exactly that kind of store.
  forgetUnsavedChanges();
  vi.restoreAllMocks();
});

function Form(props: { id: string; dirty: boolean }) {
  useUnsavedChanges(props.id, props.dirty);
  return <p>a form</p>;
}

describe("the unsaved-changes registry", () => {
  it("is quiet until a form says otherwise", () => {
    render(<Form id="a" dirty={false} />);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("reports a form holding edits", () => {
    render(<Form id="a" dirty={true} />);
    expect(hasUnsavedChanges()).toBe(true);
  });

  it("forgets a form once it has saved", () => {
    const view = render(<Form id="a" dirty={true} />);
    expect(hasUnsavedChanges()).toBe(true);
    view.rerender(<Form id="a" dirty={false} />);
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("forgets a form that unmounts, so a screen you left cannot block you", () => {
    const view = render(<Form id="a" dirty={true} />);
    view.unmount();
    expect(
      hasUnsavedChanges(),
      "an unmounted form is still registered, so every navigation from now on " +
        "asks about edits that no longer exist anywhere",
    ).toBe(false);
  });

  it("counts two forms separately", () => {
    /*
     * The reason the registry is keyed rather than a counter or a boolean. Two
     * editors are open at once on the Organisation screen — a department and a
     * project — and saving one must not clear the other's flag.
     */
    const view = render(
      <>
        <Form id="a" dirty={true} />
        <Form id="b" dirty={true} />
      </>,
    );
    view.rerender(
      <>
        <Form id="a" dirty={false} />
        <Form id="b" dirty={true} />
      </>,
    );
    expect(
      hasUnsavedChanges(),
      "saving one of two open editors cleared the other's flag as well",
    ).toBe(true);
  });

  it("asks the browser to warn about a reload, and stops when saved", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const view = render(<Form id="a" dirty={true} />);
    expect(
      add.mock.calls.some(([type]) => type === "beforeunload"),
      "nothing listens for beforeunload, so closing the tab or reloading " +
        "discards the edit with no prompt — the half of this no router can see",
    ).toBe(true);

    view.rerender(<Form id="a" dirty={false} />);
    expect(
      remove.mock.calls.some(([type]) => type === "beforeunload"),
      "the beforeunload listener outlived the edit, so the browser goes on " +
        "warning about work that has already been saved",
    ).toBe(true);
  });
});
