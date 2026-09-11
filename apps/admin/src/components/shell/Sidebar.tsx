/**
 * The console's navigation column.
 *
 * Lifted out of `Console`, where it was a 70-line JSX expression assigned to a
 * local `const nav` and handed to `Shell` as a prop. That shape is why the
 * sidebar had no test of its own: rendering it meant rendering a signed-in
 * console against an API, so the questions it actually has to answer — does a
 * `course_editor` see a *Teilnahme* heading with nothing under it, does the
 * active row carry `aria-current` — were only ever answered by looking.
 *
 * A sidebar rather than a row of tabs, which is a decision worth keeping
 * written down: there are eight destinations and the list grows with every
 * feature, a tab row that wraps onto a second line stops reading as navigation
 * at all, and the content is mostly tables, which want the horizontal space a
 * vertical nav leaves them.
 *
 * It renders what it is given. Which groups those are is `visibleNav`'s
 * decision in `navigation.ts`, and it is made there so that it can be answered
 * without a browser.
 */

import { de } from "../../locale/de.js";
import type { Route } from "../../routes.js";
import type { NavGroup } from "./navigation.js";

export function Sidebar(props: {
  /** Already filtered by capability — see `visibleNav`. */
  groups: readonly NavGroup[];
  active: Route["kind"];
  onNavigate: (kind: Route["kind"]) => void;
}) {
  return (
    <nav className="px-2 pb-4" aria-label={de.nav.menu}>
      {props.groups.map((group, groupIndex) => {
        /*
         * A labelled list, not a heading.
         *
         * These were `h2`, which put them at the same level as the page title
         * `Page` draws — so a screen reader's heading list read "Angebot,
         * Teilnahme, Einstellungen, Fortbildungen" as four peers, and the one
         * that names the screen you are on was last. `aria-labelledby` on the
         * list says the same thing without competing for the document outline.
         */
        const headingId = `ds-nav-group-${groupIndex}`;

        return (
          <div key={group.heading} className="mb-4">
            <p
              id={headingId}
              className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35"
            >
              {group.heading}
            </p>
            <ul aria-labelledby={headingId}>
              {group.sections.map((section) => {
                const active = props.active === section.kind;
                return (
                  <li key={section.kind}>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        props.onNavigate(section.kind);
                      }}
                      className={`mb-0.5 block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--ds-ink)] ${
                        active
                          ? "bg-brand-500 text-white shadow-[0_1px_12px_-2px_rgba(228,0,61,0.65)]"
                          : "text-white/65 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {section.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
