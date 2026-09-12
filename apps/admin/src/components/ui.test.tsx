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
import { Button, ConfirmButton, Field, Select, TextArea, TextInput } from "./ui.js";

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

describe("a refused delete is marked, not narrated (P100-01)", () => {
  /*
   * The screenshot that prompted this had the same 118-character sentence
   * three times on one screen — once per level of module → chapter → content —
   * rendered where the button would be, which is what pushed every row to full
   * width and left the right of the screen empty.
   */
  it("shows the short label on the row", () => {
    render(
      <ConfirmButton
        label="Löschen"
        confirmLabel="Wirklich"
        cancelLabel="Abbrechen"
        disabledReason="Kann nicht gelöscht werden: es sind bereits Teilnahmen erfasst."
        lockedLabel="Gesperrt"
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText("Gesperrt")).toBeTruthy();
    // The sentence is not *drawn* — but it is still reachable, below.
    expect(screen.queryByText(/bereits Teilnahmen erfasst/u)).toBeNull();
  });

  it("keeps the full reason as the accessible name, so nothing is lost", () => {
    // §9.4: the reason still has to reach somebody who cannot hover. A marker
    // whose only explanation is a `title` is a marker with no explanation on a
    // phone or to a screen reader.
    const reason = "Kann nicht gelöscht werden: es sind bereits Teilnahmen erfasst.";
    render(
      <ConfirmButton
        label="Löschen"
        confirmLabel="Wirklich"
        cancelLabel="Abbrechen"
        disabledReason={reason}
        lockedLabel="Gesperrt"
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByLabelText(reason)).toBeTruthy();
  });

  it("falls back to the full reason when no short label is given", () => {
    // So a caller that has not been updated still says something true.
    render(
      <ConfirmButton
        label="Löschen"
        confirmLabel="Wirklich"
        cancelLabel="Abbrechen"
        disabledReason="Weil nicht."
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText("Weil nicht.")).toBeTruthy();
  });

  it("still offers the delete when nothing blocks it", () => {
    render(
      <ConfirmButton
        label="Löschen"
        confirmLabel="Wirklich"
        cancelLabel="Abbrechen"
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByText("Löschen")).toBeTruthy();
  });
});

/**
 * One spelling of the accessible name, across all four primitives (P223-02).
 *
 * `Button` declared `ariaLabel` while `TextInput` and `Select` declared
 * `"aria-label"`, and a **hyphenated** JSX attribute is never checked against a
 * component's props — so the call site that guessed wrong got silence. The top
 * bar's language switch passed `aria-label` from P86-01 until P223 and was
 * named "EN" to a screen reader, to the one person who most needs it.
 *
 * Asserted through the **accessible name**, not the attribute: `getByRole(…, {
 * name })` is what a screen reader computes, so this fails if the attribute is
 * dropped *and* if something else overrides it. `node scripts/aria-props.mjs`
 * covers the other direction — a component given a hyphenated prop it does not
 * declare — because a type cannot.
 */
describe("the accessible name, one spelling everywhere", () => {
  it("gives a Button the name it was passed, not its visible text", () => {
    render(
      <Button aria-label="Sprache wechseln zu English" onClick={() => undefined}>
        EN
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Sprache wechseln zu English" });
    expect(button.textContent).toBe("EN");
  });

  it("gives an unarmed ConfirmButton the name it was passed", () => {
    // A list draws one per row; eleven buttons all named "Löschen" is a name
    // collision a screen reader cannot resolve except by counting.
    render(
      <ConfirmButton
        label="Löschen"
        aria-label="Fortbildung ADHS löschen"
        confirmLabel="Wirklich löschen"
        cancelLabel="Abbrechen"
        onConfirm={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Fortbildung ADHS löschen" }).textContent,
    ).toBe("Löschen");
  });

  it("leaves the visible text as the name when none was passed", () => {
    // The common case, and the one that must not gain an empty label.
    render(<Button onClick={() => undefined}>Speichern</Button>);
    expect(screen.getByRole("button", { name: "Speichern" })).toBeTruthy();
  });
});

/**
 * A form field has a readable measure (P225-02).
 *
 * `Shell`'s own comment has claimed since P100-01 that the console "capped …
 * form fields at `max-w-2xl`, each where it is rendered". Prose was capped;
 * fields were not, and `max-w-2xl` appeared in exactly one component, which was
 * not a field. The rule was written, read as done, and never applied — and the
 * comment asserting it is why nobody looked (§9.3, §11.9).
 *
 * The cap lives in `Field` rather than at its 109 call sites, for the reason
 * `Table` already gives for cell padding: a rule at fifty call sites is a rule
 * that disagrees with itself.
 */
describe("Field's width", () => {
  function measured(node: HTMLElement | null): string {
    if (node === null) throw new Error("Field rendered nothing");
    return node.className;
  }

  it("caps an ordinary field, so a name is not 1,100 px wide", () => {
    const { container } = render(
      <Field label="Name" htmlFor="n">
        <TextInput id="n" value="" onChange={() => undefined} />
      </Field>,
    );
    expect(measured(container.firstElementChild as HTMLElement)).toContain("max-w-2xl");
  });

  it("lets a field opt out when it genuinely wants the room", () => {
    // German body copy, a rich-text editor, an editor spanning a panel. Opt-in,
    // because the default being wrong is how this happened.
    const { container } = render(
      <Field label="Einleitung" htmlFor="i" wide>
        <TextArea id="i" value="" onChange={() => undefined} />
      </Field>,
    );
    expect(measured(container.firstElementChild as HTMLElement)).not.toContain(
      "max-w-2xl",
    );
  });

  it("caps the box and not the control, so nothing inside is clipped", () => {
    // The cap is on the field's own wrapper. A control that asks for the full
    // width of that wrapper still gets it — which is what keeps a colour well,
    // a select and a text input the same width as each other.
    render(
      <Field label="Farbe" htmlFor="c">
        <TextInput id="c" value="#007f95" onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByLabelText("Farbe").className).toContain("w-full");
  });
});
