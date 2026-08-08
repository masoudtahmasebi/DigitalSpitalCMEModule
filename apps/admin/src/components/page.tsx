/**
 * The page frame every console screen renders inside (P30-02).
 *
 * ## Why this exists
 *
 * Ten screens each drew their own heading, their own intro paragraph, their own
 * "saved" banner and their own empty state, in slightly different markup. The
 * result reads as ten small tools that happen to share a sidebar rather than
 * one console, and an operator learns each screen separately instead of
 * learning the console once.
 *
 * react-admin's answer is the one adopted here — not its code, its shape:
 *
 * | react-admin | here |
 * | --- | --- |
 * | `Title` + `ListActions` in a toolbar | `Page` — title, description, actions |
 * | `Breadcrumb` | `Page`'s `trail`, for the nested course editor |
 * | `Empty` — icon, "no X yet", invite | `EmptyState` |
 * | `Datagrid` inside a `Card` | `Panel` + `Table` (already present) |
 *
 * The rule this file enforces is that **the title is where the title goes and
 * the actions are where the actions go**, on every screen, so the second screen
 * an operator opens is already familiar.
 *
 * ## Why a trail rather than a router
 *
 * The console has no URL routing (see `App.tsx`), so a breadcrumb cannot be
 * derived from a path. It is passed explicitly. That is a smaller lie than it
 * looks: the deep part of this console is the course editor, where the nesting
 * is course → module → chapter → content → quiz, and every level already knows
 * its parent because it was navigated to from one. What was missing was
 * *showing* it — five levels deep, the only clue about where you were was
 * whichever heading the innermost editor happened to render.
 */

import type { ReactNode } from "react";

export interface Crumb {
  readonly label: string;
  /**
   * Where clicking this crumb goes. Absent when the crumb is where you already
   * are — in which case it carries `aria-current="page"` instead.
   *
   * A trail may legitimately be all-clickable: the convention here is that the
   * trail names the levels *above* and the `Page` title names the current one,
   * so nothing is written out twice.
   */
  readonly onClick?: () => void;
}

/**
 * A screen's header.
 *
 * `title` is an `h2` because the app bar owns the `h1`. Screens must not draw
 * their own heading on top of this one; that was the previous state and it
 * produced two competing titles on several screens.
 */
export function Page(props: {
  title: string;
  description?: string;
  /** Buttons for the screen as a whole — "Neue Fortbildung", an export. */
  actions?: ReactNode;
  /** Where this screen sits, when it sits inside something. */
  trail?: readonly Crumb[];
  children: ReactNode;
}) {
  return (
    <section className="space-y-5">
      {props.trail === undefined || props.trail.length === 0 ? null : (
        <Breadcrumbs trail={props.trail} />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">{props.title}</h2>
          {props.description === undefined ? null : (
            <p className="mt-1 max-w-3xl text-sm text-gray-600">{props.description}</p>
          )}
        </div>
        {props.actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
        )}
      </div>

      {props.children}
    </section>
  );
}

/**
 * Where you are, and one click back to each level above.
 *
 * `nav` + `aria-label` so a screen reader announces it as navigation rather
 * than as a stray line of text, and the current page carries `aria-current`.
 * The separator is `aria-hidden` — "Fortbildungen slash ADHS slash Modul 1"
 * is not what anybody wants read out.
 */
function Breadcrumbs(props: { trail: readonly Crumb[] }) {
  return (
    <nav aria-label={NAV_LABEL}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-600">
        {props.trail.map((crumb, index) => {
          const last = index === props.trail.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? (
                <span aria-hidden className="text-gray-400">
                  /
                </span>
              ) : null}
              {crumb.onClick === undefined ? (
                <span
                  className={last ? "font-medium text-gray-900" : undefined}
                  {...(last ? { "aria-current": "page" as const } : {})}
                >
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={crumb.onClick}
                  className="rounded underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-600"
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const NAV_LABEL = "Pfad";

/**
 * What a list shows when it has nothing in it.
 *
 * Not a bare "keine Einträge". An empty list is the state a *new* installation
 * is in for every screen at once, and it is the moment an operator most needs
 * telling what the screen is for and what to do next — which is exactly what
 * react-admin's `Empty` does and what ten different one-line messages here did
 * not.
 */
export function EmptyState(props: {
  title: string;
  description?: string;
  /** The one obvious next step, when there is one. */
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-gray-900">{props.title}</p>
      {props.description === undefined ? null : (
        <p className="mx-auto mt-1 max-w-md text-sm text-gray-600">{props.description}</p>
      )}
      {props.action === undefined ? null : <div className="mt-4">{props.action}</div>}
    </div>
  );
}

/**
 * A list's toolbar: filters on the left, actions on the right.
 *
 * react-admin's `ListToolbar` arrangement, and it is the right one — the eye
 * goes left for "narrow this down" and right for "do something", and putting
 * them in one row keeps both above the table where they act.
 */
export function ListToolbar(props: { filters?: ReactNode; actions?: ReactNode }) {
  if (props.filters === undefined && props.actions === undefined) return null;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-wrap items-end gap-3">{props.filters}</div>
      <div className="flex flex-wrap items-center gap-2">{props.actions}</div>
    </div>
  );
}
