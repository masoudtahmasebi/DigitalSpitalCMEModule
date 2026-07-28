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
 * The progress ring from the layout.
 *
 * `percent` comes from the server. There is deliberately no way to pass the
 * parts and let this compute it — a percentage on a CME record has one
 * implementation and it is not in a rendering component.
 */
export function ProgressRing(props: { percent: number; label: string }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, props.percent));
  const dash = (clamped / 100) * circumference;

  return (
    <div
      className="relative inline-flex h-20 w-20 items-center justify-center"
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
      <span className="absolute text-sm font-semibold text-brand-700">{clamped} %</span>
    </div>
  );
}

export function GateBadge(props: { gate: GateStatus; labels: Record<GateStatus, string> }) {
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

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden="true">
      <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3Zm2 5H6V4a2 2 0 1 1 4 0v2Z" />
    </svg>
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
