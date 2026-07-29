/**
 * Shared presentational pieces.
 *
 * Everything here is dumb on purpose: no fetching, no gate decisions, no
 * German copy of its own. Copy arrives as props from `locale/de.ts`.
 */

import type { ReactNode } from "react";
import type { GateStatus } from "@ds/sdk";

export function Button(props: {
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary";
  disabled?: boolean;
  children: ReactNode;
}) {
  const variant = props.variant ?? "primary";
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
  const skin =
    variant === "primary"
      ? "bg-brand-600 text-white hover:bg-brand-700"
      : "border border-brand-600 text-brand-700 hover:bg-brand-50";

  return (
    <button
      type={props.type ?? "button"}
      className={`${base} ${skin}`}
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/**
 * The progress ring from the layout (§4.2).
 *
 * ## Why it counts modules rather than taking a percentage
 *
 * The layout's ring reads **"2 von 5"**, and the requirements record is
 * explicit that it counts *modules*: `moduleCompletion`, which the server
 * returns separately from `course.percent` precisely because the two
 * legitimately differ — the latter is content-weighted, so a learner one long
 * video into a five-module course is at 0 modules and some non-zero percent.
 *
 * Taking `completed`/`total` instead of a ready-made percent is what makes the
 * arc and the caption incapable of disagreeing: they are the same two numbers.
 * An earlier version fed the arc from `progress.percent` while labelling it
 * with the module counts, and the ring silently told a different story from the
 * sentence beside it.
 *
 * The fraction is still not a compliance figure — both numbers are the
 * server's, and this only draws them.
 */
export function ProgressRing(props: {
  completed: number;
  total: number;
  /** Centre text, "2 von 5". */
  value: string;
  /** Accessible name — the full sentence, since "2 von 5" alone says nothing. */
  label: string;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(0, props.total);
  const completed = Math.max(0, Math.min(total, props.completed));
  // A course with no modules draws an empty ring rather than dividing by zero.
  const fraction = total === 0 ? 0 : completed / total;
  const dash = fraction * circumference;

  return (
    <div
      className="relative inline-flex h-20 w-20 shrink-0 items-center justify-center"
      role="img"
      aria-label={props.label}
    >
      <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#255a94"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span className="absolute text-sm font-semibold text-brand-700">{props.value}</span>
    </div>
  );
}

export function GateBadge(props: {
  gate: GateStatus;
  labels: Record<GateStatus, string>;
}) {
  const skin: Record<GateStatus, string> = {
    locked: "bg-gray-100 text-status-locked",
    available: "bg-brand-50 text-brand-700",
    completed: "bg-green-50 text-status-completed",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${skin[props.gate]}`}
    >
      {props.gate === "locked" ? <LockIcon /> : null}
      {props.labels[props.gate]}
    </span>
  );
}

export function LockIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={props.className ?? "h-3 w-3"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3Zm2 5H6V4a2 2 0 1 1 4 0v2Z" />
    </svg>
  );
}

/**
 * The four state glyphs of the player's Modul Übersicht (layout §4.3), plus
 * the fifth the layout implies — see `ItemState`.
 *
 * `role="img"` with a name rather than `aria-hidden`, because in this sidebar
 * the icon is the *only* thing distinguishing a finished chapter from a locked
 * one. A decorative padlock would leave a screen-reader user with an
 * undifferentiated list of titles and no way to tell what they may open.
 *
 * Colour carries the same information a second time and never alone (WCAG
 * 1.4.1): every state has a distinct shape.
 */
export function StateIcon(props: {
  state: "completed" | "playing" | "paused" | "available" | "locked";
  label: string;
}) {
  const skin: Record<typeof props.state, string> = {
    completed: "text-status-completed",
    playing: "text-brand-600",
    paused: "text-brand-600",
    available: "text-gray-400",
    locked: "text-status-locked",
  };

  return (
    <span
      role="img"
      aria-label={props.label}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${skin[props.state]}`}
    >
      {props.state === "locked" ? (
        <LockIcon className="h-4 w-4" />
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="currentColor"
          aria-hidden="true"
        >
          {props.state === "completed" ? (
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm3.86 5.9-4.5 5a1 1 0 0 1-1.46.04L3.9 8.94a1 1 0 1 1 1.42-1.42l1.25 1.25 3.8-4.22a1 1 0 0 1 1.49 1.34Z" />
          ) : props.state === "paused" ? (
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM7 11H5.5V5H7v6Zm3.5 0H9V5h1.5v6Z" />
          ) : props.state === "playing" ? (
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm-1.5 4.6 4.4 2.9a.6.6 0 0 1 0 1L6.5 11.4a.6.6 0 0 1-.93-.5V5.1a.6.6 0 0 1 .93-.5Z" />
          ) : (
            /* available — an outline, so "not started" is not a filled state. */
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 1.6A6.4 6.4 0 1 1 8 14.4 6.4 6.4 0 0 1 8 1.6Z" />
          )}
        </svg>
      )}
    </span>
  );
}

export function Spinner(props: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-gray-600" role="status">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
        />
      </svg>
      {props.label}
    </div>
  );
}

/**
 * `role="alert"` so a screen reader announces a failure the learner did not
 * cause and cannot see coming.
 */
export function ErrorNotice(props: {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm font-semibold text-red-800">{props.title}</p>
      <p className="mt-1 text-sm text-red-700">{props.message}</p>
      {props.onRetry !== undefined && props.retryLabel !== undefined ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={props.onRetry}>
            {props.retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-gray-900">{props.title}</h2>
      {props.children}
    </section>
  );
}
