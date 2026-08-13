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
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  if (props.disabledReason !== undefined) {
    return (
      <span className="text-xs text-gray-500" title={props.disabledReason}>
        {props.disabledReason}
      </span>
    );
  }

  if (!armed) {
    return (
      <Button variant="secondary" onClick={() => setArmed(true)}>
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

/** A bordered block. Used to separate levels of the authoring tree visually. */
export function Panel(props: {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: "default" | "nested";
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        props.tone === "nested"
          ? "border-gray-200 bg-gray-50"
          : "border-gray-300 bg-white"
      }`}
    >
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
