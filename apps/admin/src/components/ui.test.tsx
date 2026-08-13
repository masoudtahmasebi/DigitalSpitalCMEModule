/**
 * The shared controls actually carry the names they are given (P68-02).
 *
 * ## The defect this file exists because of
 *
 * The video sources editor draws a row of three controls — URL, Format,
 * Bezeichnung — under one set of column headings rather than one label each,
 * and passes `aria-label` to every one of them. `TextInput` and `Select` did
 * not accept the prop, so React dropped it: three controls per rendition with
 * no accessible name at all, on the screen an author uses to attach a video.
 *
 * Nothing caught it. TypeScript cannot: a **hyphenated** JSX attribute is never
 * checked against a component's props, because it is not a valid JavaScript
 * identifier, so `aria-label` on a component that does not declare it is
 * silently legal. The console's own tests did not, because none of them asked
 * for a control by name. And the browser suite did not, because it stopped
 * before this screen — which is how the whole class was found: the journey spec
 * looked for the Format select by its label and there was no such thing.
 *
 * ## Why the assertions are `getByRole(..., { name })`
 *
 * Because that is the query that goes red. `getByLabelText` would too, but
 * `toHaveAttribute("aria-label")` would not — it would pass on a control whose
 * name is overridden by a wrapping `<label>` or an `aria-labelledby`, which is
 * not the property anybody cares about. The property is *what a screen reader
 * announces*, and the accessible-name query is the only one that asks it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Select, TextArea, TextInput } from "./ui.js";

afterEach(cleanup);

describe("a control with no visible label", () => {
  it("takes its accessible name from aria-label — TextInput", () => {
    render(<TextInput id="t" aria-label="URL" value="" onChange={() => undefined} />);

    expect(screen.getByRole("textbox", { name: "URL" })).toBeDefined();
  });

  it("takes its accessible name from aria-label — Select", () => {
    render(
      <Select
        id="s"
        aria-label="Format"
        value="video/webm"
        options={[["video/webm", "WebM"]]}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Format" })).toBeDefined();
  });

  it("takes its accessible name from aria-label — TextArea", () => {
    render(<TextArea id="a" aria-label="Notiz" value="" onChange={() => undefined} />);

    expect(screen.getByRole("textbox", { name: "Notiz" })).toBeDefined();
  });

  /*
   * The other half, and the reason the three above are not enough on their own:
   * a component that hard-coded a name would pass all of them. This asserts
   * that an unlabelled control has no invented name — so the tests above are
   * about the prop being forwarded rather than about a string existing.
   */
  it("has no name at all when none is given", () => {
    render(<TextInput id="t" value="" onChange={() => undefined} />);

    expect(screen.queryByRole("textbox", { name: /.+/u })).toBeNull();
  });
});
