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
  type?: string | undefined;
  maxLength?: number | undefined;
  autoComplete?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={props.id}
      type={props.type ?? "text"}
      value={props.value}
      maxLength={props.maxLength}
      autoComplete={props.autoComplete}
      onChange={(event) => props.onChange(event.target.value)}
      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
    />
  );
}

export function TextArea(props: {
  id: string;
  value: string;
  rows?: number | undefined;
  maxLength?: number | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      id={props.id}
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
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <select
      id={props.id}
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

export function Spinner(props: { label: string }) {
  return (
    <p className="py-8 text-sm text-gray-600" role="status">
      {props.label}
    </p>
  );
}

export function Notice(props: {
  tone: "error" | "warning" | "success";
  title?: string;
  children: ReactNode;
}) {
  const skin =
    props.tone === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : props.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-green-200 bg-green-50 text-green-800";

  return (
    <div className={`rounded-md border p-3 text-sm ${skin}`} role="alert">
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

/** A plain table. Scrolls horizontally rather than squashing on a narrow screen. */
export function Table(props: { headers: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            {props.headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-3 py-2 font-semibold text-gray-700"
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
