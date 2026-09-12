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
import { de } from "../locale/de.js";
import {
  Button,
  ConfirmButton,
  Field,
  FieldError,
  LoadFailure,
  Select,
  TextArea,
  TextInput,
} from "./ui.js";

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

/**
 * The retry control is absent when retrying cannot work (P231-02).
 *
 * ## Why this is a component test and not a unit test of `isRetryable`
 *
 * `api.test.ts` already proves `isRetryable(failure(404))` is `false`
 * exhaustively. That is §9.7's trap in one line: **nothing in that file checks
 * that anybody calls it.** The rule could be perfect and every screen could go
 * on drawing the button, and the suite would stay green — which is exactly
 * what happened to `inviteStatus`, `resetStatus` and `invalidBrandingFields`
 * (§9.3).
 *
 * So the property asserted here is the *rendering*, by role, the way a person
 * meets it.
 *
 * Wiring it up the stack is the other half, and TypeScript is what enforces
 * that: `retryable` is a **required** prop, so all eleven `LoadFailure` call
 * sites had to answer the question. The compiler named every one of them.
 */
describe("LoadFailure", () => {
  const common = {
    title: de.error.title,
    retryLabel: de.error.retry,
    onRetry: () => undefined,
  };

  it("offers a retry for a failure that could go the other way", () => {
    render(<LoadFailure {...common} problem={de.error.generic} retryable={true} />);
    expect(screen.getByRole("button", { name: de.error.retry })).toBeTruthy();
  });

  it("withholds it entirely when trying again cannot work", () => {
    render(<LoadFailure {...common} problem={de.error.gone} retryable={false} />);
    expect(
      screen.queryByRole("button", { name: de.error.retry }),
      "a retry control was drawn beside a sentence saying the entry no longer " +
        "exists — a control that can only produce the same error, which looks " +
        "like a decision to whoever clicks it (§9.2)",
    ).toBeNull();
  });

  it("still says what happened when it withholds the control", () => {
    /*
     * The half that makes §9.2 safe to apply: removing an affordance is only
     * an improvement if something else says what to do instead. `de.error.gone`
     * ends "Bitte laden Sie die Seite neu" — so the screen is not merely
     * quieter, it is answerable (§9.4, §9.10).
     */
    render(<LoadFailure {...common} problem={de.error.gone} retryable={false} />);
    expect(screen.getByText(de.error.gone)).toBeTruthy();
    expect(de.error.gone).toContain("neu");
  });
});

/**
 * An error beside a field reaches a screen reader (P233-02).
 *
 * ## The claim this replaces, which was mine and was wrong
 *
 * P231 said *"`Notice` is not a live region, so a screen reader is not told
 * when an error appears."* It is one — `ui.tsx` spreads `role="alert"` onto
 * every tone but `info`. The correction is recorded in that ticket rather than
 * the sentence deleted.
 *
 * What **was** silent is narrower: the error rendered beside a field, five bare
 * red paragraphs across four files, in no live region at all. A sighted
 * operator sees red appear under the input they just used; a screen reader user
 * gets nothing, with the focus still in the field.
 *
 * ## Why the assertion is the role and not the class
 *
 * `toHaveClass("text-red-700")` would pass on a paragraph nothing announces,
 * which is the property that was broken. `getByRole("alert")` is the one that
 * goes red.
 */
describe("FieldError", () => {
  it("announces, rather than only turning red", () => {
    render(<FieldError>Die Änderung konnte nicht gespeichert werden.</FieldError>);
    expect(
      screen.getByRole("alert"),
      "the field error is in no live region, so a screen reader user is not " +
        "told their save was refused — the focus is still in the field and " +
        "nothing interrupts to say so",
    ).toBeTruthy();
  });

  it("is what `Field` renders for its own problem, so 109 call sites get it", () => {
    /*
     * §9.7, name the caller. `FieldError` announcing proves nothing if `Field`
     * still renders its own paragraph — which is exactly the shape §9.3 keeps
     * catching on this project.
     */
    render(
      <Field label="Name" htmlFor="x" problem="Pflichtfeld">
        <TextInput id="x" value="" onChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Pflichtfeld");
  });
});
