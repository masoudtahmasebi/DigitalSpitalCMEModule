/**
 * The bar across the top of every console screen.
 *
 * Out of `Shell` for the same reason the sidebar came out of `Console`: it is
 * the part a person looks at on every screen, it carries three controls that
 * each have a reason to exist, and it could not be rendered without the whole
 * frame around it.
 *
 * Three things live here and the grouping is deliberate — they are all about
 * *the person and their session*, not about the screen:
 *
 * - **Which scope they are acting in** (the customer picker, passed in).
 * - **Who they are.** An operator with two accounts — their own and a super
 *   admin one — otherwise has no way to tell which they are acting as, and the
 *   two differ in what they can destroy.
 * - **Which language they read, and the way out.** The language switch is in
 *   the header rather than under Einstellungen because it is not a setting
 *   about the platform: it is a property of the person reading the screen, and
 *   somebody who cannot read the current language must be able to find it
 *   without navigating through it. Switching reloads — see
 *   `locale/language.ts` for why that is the design and not a shortcut.
 */

import { Button } from "../ui.js";
import { de } from "../../locale/de.js";
import { chooseLanguage, currentLanguage } from "../../locale/language.js";
import type { ReactNode } from "react";

export function TopBar(props: {
  /**
   * Signed out, the bar is a title and nothing else — there is no session to
   * describe and nowhere to go.
   */
  signedIn: boolean;
  operator?: string | undefined;
  onSignOut?: (() => void) | undefined;
  /** Scope controls — the customer picker. */
  scope?: ReactNode;
  menuOpen: boolean;
  onToggleMenu?: (() => void) | undefined;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3">
      {props.signedIn ? (
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-expanded={props.menuOpen}
            onClick={() => props.onToggleMenu?.()}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 shadow-sm md:hidden"
          >
            {props.menuOpen ? de.nav.closeMenu : de.nav.menu}
          </button>
          {props.scope}
        </div>
      ) : (
        <h1 className="text-base font-semibold text-gray-900">{de.appTitle}</h1>
      )}

      {props.signedIn ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{props.operator}</span>
          <Button
            variant="secondary"
            aria-label={de.language.switchTo(
              currentLanguage() === "de" ? de.language.english : de.language.german,
            )}
            onClick={() => chooseLanguage(currentLanguage() === "de" ? "en" : "de")}
          >
            {currentLanguage() === "de" ? "EN" : "DE"}
          </Button>
          <Button variant="secondary" onClick={() => props.onSignOut?.()}>
            {de.auth.signOut}
          </Button>
        </div>
      ) : null}
    </header>
  );
}
