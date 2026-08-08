/**
 * The inline _Mehr lesen…_ fold (#63).
 *
 * Two behaviours, and both were wrong before:
 *
 * - no toggle at all when nothing is hidden — the old `line-clamp` version
 *   drew one on a two-line description and clicking it did nothing;
 * - the full text after one activation, so the fold hides prose rather than
 *   losing it.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReadMore } from "./ReadMore.js";

afterEach(cleanup);

const LONG =
  "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy " +
  "eirmod tempor invidunt ut labore et dolore magna aliquyam erat.";

describe("a text that fits", () => {
  it("is shown whole, with no toggle", () => {
    render(<ReadMore text="Kurz und vollständig." limit={200} />);

    expect(screen.getByText("Kurz und vollständig.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a text that does not fit", () => {
  it("hides the tail until the toggle is used", () => {
    render(<ReadMore text={LONG} limit={40} />);

    expect(screen.queryByText(/aliquyam erat/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Mehr lesen/ }));

    expect(screen.getByText(/aliquyam erat/)).toBeTruthy();
  });

  it("announces its state, and offers the way back", () => {
    // `aria-expanded` is what makes a button honest about doing nothing but
    // revealing text. It is also the whole reason this is not a link.
    render(<ReadMore text={LONG} limit={40} />);
    const toggle = screen.getByRole("button");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Weniger anzeigen/ })).toBeTruthy();
  });

  it("keeps the toggle inline, in the same paragraph as the text", () => {
    // The layout row this ticket exists for: teal and bold at the end of the
    // last visible word, not an underlined link on a line of its own.
    render(<ReadMore text={LONG} limit={40} />);

    const toggle = screen.getByRole("button");
    expect(toggle.parentElement?.tagName).toBe("P");
    expect(toggle.className).toContain("font-bold");
    expect(toggle.className).not.toContain("underline");
  });
});
