/**
 * Shared presentational pieces for the console.
 *
 * Functional rather than beautiful, by instruction (P9 header): reporting is a
 * list, not a dashboard, and there are deliberately no charts anywhere in this
 * app.
 */

import { useState, type ReactNode } from "react";

export function Button(props: {
  onClick?: () => void;
  type?: "button" | "submit";
  /**
   * A stable handle for a control the browser suite has to find precisely.
   *
   * Used where several buttons on one screen share a label — the media dialog's
   * opener appears once per file field — and a positional locator would depend
   * on the order the form happens to render in (P90-01).
   */
  id?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  /**
   * The button's name for assistive technology, when the visible label is not
   * enough on its own.
   *
   * A list of rows each ending in "Bearbeiten" reads to a screen reader as a
   * page of identical buttons — the row is visual context that the accessible
   * name does not carry. Pass "Projekt MEDICE bearbeiten" and the visible text
   * stays "Bearbeiten".
   *
   * Leave it unset when the label already says what the button does.
   */
  ariaLabel?: string;
  children: ReactNode;
}) {
  const variant = props.variant ?? "primary";
  const skin =
    variant === "primary"
      ? "bg-brand-600 text-white hover:bg-brand-700"
      : variant === "danger"
        ? "bg-red-700 text-white hover:bg-red-800"
        : "border border-gray-300 text-gray-800 hover:bg-gray-50";

  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled === true}
      onClick={props.onClick}
      {...(props.id === undefined ? {} : { id: props.id })}
      {...(props.ariaLabel === undefined ? {} : { "aria-label": props.ariaLabel })}
      className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50 ${skin}`}
    >
      {props.children}
    </button>
  );
}

export function Field(props: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
  problem?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.htmlFor} className="block text-sm font-medium text-gray-900">
        {props.label}
      </label>
      {props.children}
      {props.hint === undefined ? null : (
        <p className="text-xs text-gray-600">{props.hint}</p>
      )}
      {props.problem === undefined ? null : (
        <p className="text-xs font-medium text-red-700">{props.problem}</p>
      )}
    </div>
  );
}

export function TextInput(props: {
  id: string;
  value: string;
  /**
   * For a field with no visible `<label>` (P68-02).
   *
   * ## Why this is declared rather than left to slip through
   *
   * It was not, and three controls lost their names because of it. The video
   * sources editor renders a row of URL, Format and Bezeichnung with the column
   * headings above the list rather than a label per cell, and passes
   * `aria-label` to each — correctly. These components did not accept it, so
   * React dropped it and a screen reader announced "Eingabefeld, leer" three
   * times per rendition.
   *
   * TypeScript did not object: a **hyphenated** JSX attribute is never checked
   * against a component's props, because it cannot be a JavaScript identifier.
   * So the rule was written, looked enforced, and was not — CLAUDE.md §9.3, in
   * the one place the compiler cannot see.
   */
  "aria-label"?: string | undefined;
  type?: string | undefined;
  maxLength?: number | undefined;
  autoComplete?: string | undefined;
  /**
   * `numeric` for the TOTP code, so a phone offers a digit pad rather than a
   * full keyboard for six digits. Not `type="number"`, which strips leading
   * zeros — and a one-in-ten TOTP code starts with one.
   */
  inputMode?: "numeric" | "text" | undefined;
  onChange: (value: string) => void;
  /**
   * Called when the field is finished with (P88-01).
   *
   * For a field whose value is saved rather than merely held: the Mediathek
   * writes a rename here instead of from `onChange`, which was one request per
   * keystroke racing the typist. Enter fires it too, because a form with one
   * field per row is one people finish with the keyboard.
   */
  onBlur?: (() => void) | undefined;
}) {
  return (
    <input
      id={props.id}
      aria-label={props["aria-label"]}
      type={props.type ?? "text"}
      value={props.value}
      maxLength={props.maxLength}
      autoComplete={props.autoComplete}
      inputMode={props.inputMode}
      onChange={(event) => props.onChange(event.target.value)}
      onBlur={props.onBlur}
      onKeyDown={
        props.onBlur === undefined
          ? undefined
          : (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                props.onBlur?.();
              }
            }
      }
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
    />
  );
}

export function TextArea(props: {
  id: string;
  /** See `TextInput` — declared so a passed label is not silently dropped. */
  "aria-label"?: string | undefined;
  value: string;
  rows?: number | undefined;
  maxLength?: number | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      id={props.id}
      aria-label={props["aria-label"]}
      value={props.value}
      rows={props.rows ?? 4}
      maxLength={props.maxLength}
      onChange={(event) => props.onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
    />
  );
}

export function Select<T extends string>(props: {
  id: string;
  /** See `TextInput` — declared so a passed label is not silently dropped. */
  "aria-label"?: string | undefined;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      id={props.id}
      aria-label={props["aria-label"]}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value as T)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
    >
      {props.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

/**
 * A small square button carrying only an icon-ish glyph.
 *
 * `label` is mandatory and becomes the accessible name. The glyph is
 * `aria-hidden`, so a screen reader reads "Nach oben verschieben" rather than
 * "up arrow" — these are the reorder controls, and a control whose purpose a
 * screen-reader user cannot determine is not a control (CLAUDE.md §3, the a11y
 * floor is costed in and not reducible).
 */
export function IconButton(props: {
  label: string;
  glyph: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled === true}
      onClick={props.onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-30"
    >
      <span aria-hidden="true">{props.glyph}</span>
    </button>
  );
}

/**
 * A screen that could not load, with a way to try again.
 *
 * Four editors rendered this identically before the best-practices audit found
 * it. Four copies of a two-element block is not a crisis, but it is four places
 * a retry button can go missing — and a load failure with no way out is the
 * one error state a user cannot work around.
 */
export function LoadFailure(props: {
  title: string;
  retryLabel: string;
  problem: string;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      <Notice tone="error" title={props.title}>
        {props.problem}
      </Notice>
      <Button variant="secondary" onClick={props.onRetry}>
        {props.retryLabel}
      </Button>
    </div>
  );
}

/**
 * The error from the last save, if there was one.
 *
 * Renders nothing when there is none, so callers write `<SaveProblem …/>`
 * rather than the six-line ternary this replaces. Six copies of that ternary
 * existed; the one thing they all got right was showing the API's own German
 * sentence rather than a generic one, and keeping that consistent is the point.
 */
export function SaveProblem(props: { title: string; problem: string | undefined }) {
  if (props.problem === undefined) return null;
  return (
    <Notice tone="error" title={props.title}>
      {props.problem}
    </Notice>
  );
}

export function Spinner(props: { label: string }) {
  return (
    <p className="py-8 text-sm text-gray-600" role="status">
      {props.label}
    </p>
  );
}

export function Notice(props: {
  /**
   * `info` is not a quieter `warning`: it carries no `role="alert"`, so a
   * screen reader is not interrupted to be told something that is merely true.
   * A warning says an action has a consequence; info explains what a form is
   * doing.
   */
  tone: "error" | "warning" | "success" | "info";
  title?: string;
  children: ReactNode;
}) {
  const skin =
    props.tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : props.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : props.tone === "info"
          ? "border-gray-200 bg-gray-50 text-gray-700"
          : "border-green-200 bg-green-50 text-green-800";

  return (
    <div
      className={`rounded-md border p-3 text-sm ${skin}`}
      {...(props.tone === "info" ? {} : { role: "alert" })}
    >
      {props.title === undefined ? null : <p className="font-semibold">{props.title}</p>}
      {props.children}
    </div>
  );
}

export function Badge(props: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  const skin =
    props.tone === "ok"
      ? "bg-green-50 text-green-800"
      : props.tone === "warn"
        ? "bg-amber-50 text-amber-900"
        : "bg-gray-100 text-gray-600";

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${skin}`}>
      {props.children}
    </span>
  );
}

/**
 * A destructive action that asks once, inline.
 *
 * Inline rather than a modal dialog on purpose. A modal has to trap focus,
 * restore it on close, and be dismissible by Escape, and getting any of those
 * subtly wrong makes the console unusable by keyboard — for a confirmation that
 * is one sentence long. Two buttons that swap places do the same job with
 * nothing to get wrong.
 *
 * `disabledReason` is the more important half: when a delete is refused because
 * learners have used the thing, the console says so *before* the click rather
 * than turning the API's 409 into a surprise.
 */
export function ConfirmButton(props: {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  disabledReason?: string | undefined;
  /**
   * The short form shown on the row — two or three words. The full
   * `disabledReason` stays as the title and the accessible name, so nothing is
   * lost, it is only no longer shouted on every line.
   */
  lockedLabel?: string | undefined;
  /**
   * The accessible name, when "Löschen" alone does not say what (P101-02).
   *
   * A list screen draws one of these per row, and eleven buttons all named
   * "Löschen" is a name collision: a screen reader announces the same thing
   * eleven times and the rows become distinguishable only by counting. The
   * visible label stays short; the name says which course.
   */
  ariaLabel?: string | undefined;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  /*
   * A refused delete is marked, not narrated (P100-01).
   *
   * This used to render the whole reason inline, where the button would be —
   * on the course structure screen that is the same 118-character sentence
   * three times, once per level, and it is what pushed every row to full width
   * and left the right-hand side of the screen empty. On a phone it was three
   * lines per row.
   *
   * The information design was also inverted: the *rule* is identical on every
   * row and the *fact* is what varies. So the row carries a short marker with
   * the reason as its accessible name, and the screen states the rule once —
   * which is what §9.4 asks for, rather than three verbatim repetitions of it.
   *
   * `title` and `aria-label` both, because a title alone is unreachable by
   * touch and by a screen reader that does not announce it.
   */
  if (props.disabledReason !== undefined) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600"
        title={props.disabledReason}
        aria-label={props.disabledReason}
      >
        <LockGlyph />
        {props.lockedLabel ?? props.disabledReason}
      </span>
    );
  }

  if (!armed) {
    return (
      <Button
        variant="secondary"
        {...(props.ariaLabel === undefined ? {} : { ariaLabel: props.ariaLabel })}
        onClick={() => setArmed(true)}
      >
        {props.label}
      </Button>
    );
  }

  return (
    <span className="inline-flex gap-2">
      <Button
        variant="danger"
        onClick={() => {
          setArmed(false);
          props.onConfirm();
        }}
      >
        {props.confirmLabel}
      </Button>
      <Button variant="secondary" onClick={() => setArmed(false)}>
        {props.cancelLabel}
      </Button>
    </span>
  );
}

/**
 * One row of a hierarchy — module, chapter, content (P100-02).
 *
 * ## The pattern, and why it is not a card
 *
 * The authoring tree drew a bordered `Panel` per level, nested three deep. Every
 * dashboard that handles hierarchical content well — Linear's issue tree,
 * Vercel's project settings, Stripe's nested resources, react-admin's own
 * `Datagrid` — uses **rows separated by hairlines inside one surface**, not a
 * card per item. Three reasons, all of which the console was paying:
 *
 * 1. A card per row spends 2 × border + 2 × padding on *every* item, so ten
 *    modules cost twenty borders of vertical space that carry no information.
 * 2. Nested cards make the deepest item — the one with the most controls —
 *    the narrowest, because it has paid that padding three times.
 * 3. Cards imply "separate things". A module and its chapters are one thing.
 *
 * ## The anatomy, which is the actually load-bearing part
 *
 * ```
 * ┌───────────────────────────────────────────────────────────────┐
 * │ MODUL 1  Grundlagen                        [↑] [↓] [Bearbeiten] │
 * │ ADHS-Definition · Epidemiologie                       Gesperrt  │
 * └───────────────────────────────────────────────────────────────┘
 *   eyebrow  title                                          actions
 *   meta ────────────────────────────────────────────────────────
 * ```
 *
 * The eyebrow sits **inline** with the title. It used to be followed by `<br/>`,
 * which spent a whole line on the word "MODULE" — on a screen that stacks
 * module, chapter and content, that is three lines of nothing before any
 * content. Actions are right-aligned and grouped, so the eye finds them in the
 * same place on every row instead of wherever the title happened to end.
 */
export function Row(props: {
  /** "MODUL 1" — small, muted, inline before the title. */
  eyebrow?: string;
  title: ReactNode;
  /** Subtitle, counts, anything that qualifies the title. One muted line. */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            {props.eyebrow === undefined ? null : (
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {props.eyebrow}
              </span>
            )}
            <span className="text-sm font-semibold text-gray-900">{props.title}</span>
          </div>
          {props.meta === undefined ? null : (
            <div className="mt-0.5 text-xs text-gray-600">{props.meta}</div>
          )}
        </div>
        {props.actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {props.actions}
          </div>
        )}
      </div>
      {props.children === undefined || props.children === null ? null : (
        <div className="mt-2.5 empty:mt-0">{props.children}</div>
      )}
    </div>
  );
}

/**
 * The surface rows live on: one border for the whole list, hairlines between.
 *
 * `first:border-t-0` rather than a border on each row, so the list has no double
 * rule at the top and none dangling at the bottom.
 */
export function RowList(props: {
  children: ReactNode;
  /**
   * Render an `<ol>` rather than a `<div>`.
   *
   * The authoring tree is ordered — the whole screen is about which module
   * comes first — and the move buttons are meaningless without that. The list
   * semantics have to survive the change of skin, so the ordering is still
   * announced rather than merely drawn.
   */
  ordered?: boolean;
  /**
   * Drop the border and the surface, keeping the hairlines and taking an indent
   * guide instead — `Panel`'s `flush`, for a list.
   *
   * A nested level does not need a second box to be understood as nested; it
   * needs to start further in. Three bordered surfaces is how the innermost row
   * ended up with the least room for the most controls.
   */
  flush?: boolean;
}) {
  const skin = props.flush
    ? "divide-y divide-gray-100 border-l-2 border-gray-200"
    : "divide-y divide-gray-200 overflow-hidden rounded-md border border-gray-200 bg-white";

  return props.ordered === true ? (
    <ol className={skin}>{props.children}</ol>
  ) : (
    <div className={skin}>{props.children}</div>
  );
}

/**
 * A form's field column, at prose measure (P100-02).
 *
 * Settings screens in Vercel, Stripe and Linear all cap their field column at
 * roughly 40–48rem regardless of viewport, because a text input 1400 px wide is
 * harder to use than one at 600 — the eye loses the line, and the label is
 * nowhere near the value. The console let every form span whatever the card
 * was, which on a wide monitor put "Titel" a foot from its input.
 */
export function FormColumn(props: { children: ReactNode }) {
  return <div className="max-w-2xl space-y-3">{props.children}</div>;
}

function LockGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
      <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3Zm0 1.5A1.5 1.5 0 0 1 9.5 4v2h-3V4A1.5 1.5 0 0 1 8 2.5Z" />
    </svg>
  );
}

/** A bordered block. Used to separate levels of the authoring tree visually. */
export function Panel(props: {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "nested";
  /**
   * `flush` drops the border and the surface, keeping only the padding
   * (P100-01).
   *
   * The course structure nests module → chapter → content, and with every
   * level a bordered box inside a bordered box the innermost row — which
   * carries the most controls — has the least room, having paid two borders and
   * two paddings to get there. A nested level that only needs *grouping* takes
   * an indent guide instead.
   */
  flush?: boolean;
  children: ReactNode;
}) {
  const skin = props.flush
    ? "border-l-2 border-gray-200 pl-3"
    : `rounded-md border p-3 ${
        props.tone === "nested"
          ? "border-gray-200 bg-gray-50"
          : "border-gray-300 bg-white"
      }`;

  return (
    <div className={skin}>
      {props.title === undefined && props.actions === undefined ? null : (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-900">{props.title}</div>
          <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
        </div>
      )}
      {props.children}
    </div>
  );
}

/**
 * A table on its own surface. Scrolls horizontally rather than squashing on a
 * narrow screen.
 *
 * The surface is the point (P30-02): every list screen drew its table straight
 * onto the page's grey, so rows had no edge and a table with three rows read as
 * three stray lines of text. react-admin puts its `Datagrid` in a `Card` for
 * exactly this reason, and doing it here rather than at each call site is what
 * makes all nine list screens agree without any of them deciding.
 */
export function Table(props: { headers: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left">
            {props.headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2.5 font-semibold text-gray-700"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

/**
 * An upload's progress, with a cancel (P23-04; moved here in P90-01).
 *
 * ## Why the bar is not decoration
 *
 * A lecture is hundreds of megabytes and takes minutes. A spinner with no
 * percentage in front of that is indistinguishable from a hang, and the
 * reasonable response to a hang is to reload the page — which, with no
 * resumable upload behind it, throws away everything transferred so far. The
 * percentage is what stops that.
 *
 * `role="progressbar"` with the ARIA value attributes rather than a `<progress>`
 * element: the styling has to match the rest of the console and a `<progress>`
 * is close to unstyleable across browsers. The semantics are the part that
 * matters and they are all here.
 *
 * It lives in `ui.tsx` because two components render it — the field and the
 * media dialog — and one of those renders the other. See `uploads.ts` for the
 * same reasoning applied to the upload itself.
 */
export function UploadProgress(props: {
  percent: number;
  cancelLabel: string;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={props.label}
        aria-valuenow={props.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--ds-surface)]"
      >
        <div
          className="h-full bg-[color:var(--ds-brand-500)] transition-[width]"
          style={{ width: `${props.percent}%` }}
        />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-[color:var(--ds-ink-muted)]">
        {props.percent}%
      </span>
      <Button variant="secondary" onClick={props.onCancel}>
        {props.cancelLabel}
      </Button>
    </div>
  );
}
