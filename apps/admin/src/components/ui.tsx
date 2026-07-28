/**
 * Shared presentational pieces for the console.
 *
 * Functional rather than beautiful, by instruction (P9 header): reporting is a
 * list, not a dashboard, and there are deliberately no charts anywhere in this
 * app.
 */

import type { ReactNode } from "react";

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
  type?: string;
  maxLength?: number;
  autoComplete?: string;
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
