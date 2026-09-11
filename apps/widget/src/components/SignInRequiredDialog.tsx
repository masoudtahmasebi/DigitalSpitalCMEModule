/**
 * "This needs your MEDICE account" — the moment a DocCheck visitor reaches for
 * participation (P213-01).
 *
 * ## Why a dialog and not a disabled button
 *
 * §9.2 says never offer what the system will refuse, and a **Fortbildung
 * starten** button a preview reader presses is exactly that — unless pressing
 * it produces an answer rather than an error. This is that answer. The control
 * stays, because the visitor is entitled to take part and needs to be told how;
 * removing it would leave the description with no way forward at all, which is
 * §9.4's absent field reading as an unfinished feature.
 *
 * ## Why it is modal
 *
 * Everything behind it is still readable and the visitor returns to it — but
 * the dialog is the answer to a question they just asked, and a non-modal
 * notice somewhere on the page is the shape people scroll past. `aria-modal`
 * plus the focus trap below means a screen-reader user meets it the same way a
 * sighted one does.
 *
 * ## What it does not do
 *
 * It does not call anything. There is no request a preview reader could make
 * that would succeed, so there is none to make — the action is a link to the
 * host page's own sign-in, exactly as `SignedOutNotice`'s is, and for the same
 * reason: signing in is a navigation, it belongs in history, and somebody may
 * want it in a new tab.
 */

import { useEffect, useRef } from "react";
import { de } from "../locale/de.js";
import { Button } from "./primitives.js";

/** Everything that can hold focus inside the panel. */
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SignInRequiredDialog(props: {
  /** Where the host signs somebody in. Absent when the page named none. */
  signInUrl: string | undefined;
  onDismiss: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  /*
   * Focus in, focus kept, focus back.
   *
   * The widget renders inside a **closed** shadow root, so `document.activeElement`
   * outside it cannot see in and the page's own focus handling does not apply
   * here — the trap has to be the component's own. Restoring afterwards matters
   * more than usual: dismissing this returns the reader to the course
   * description they were reading, and a lost focus position sends a keyboard
   * user back to the top of the host page.
   */
  useEffect(() => {
    const previous = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onDismiss();
        return;
      }
      if (event.key !== "Tab" || panel.current === null) return;

      const stops = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (stops.length === 0) return;
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [props]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
      /*
       * The backdrop dismisses, and only the backdrop: `onClick` here fires for
       * clicks inside the panel too unless the target is checked, which is how
       * a dialog closes while somebody is selecting the text in it.
       */
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onDismiss();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-preview-dialog-title"
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl sm:p-8"
      >
        <div className="flex items-start gap-4">
          <h2
            id="ds-preview-dialog-title"
            className="min-w-0 flex-1 text-lg font-bold text-gray-900"
          >
            {de.preview.dialog.title}
          </h2>
          <button
            type="button"
            className="-mr-2 -mt-2 shrink-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            onClick={props.onDismiss}
          >
            {/* The glyph is decorative; the accessible name is beside it. */}
            <span aria-hidden="true">✕</span>
            <span className="sr-only">{de.preview.dialog.close}</span>
          </button>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-gray-700">
          {de.preview.dialog.message}
        </p>

        <p className="mt-5 text-sm font-semibold text-gray-900">
          {de.preview.dialog.lead}
        </p>
        <ul className="mt-2 space-y-2">
          {de.preview.dialog.items.map((item) => (
            <li key={item} className="flex gap-3 text-sm text-gray-800">
              {/* Decorative: the sentence above introduces the list. */}
              <span aria-hidden="true" className="text-brand-600">
                •
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {props.signInUrl === undefined || props.signInUrl === "" ? null : (
            <a
              className="inline-flex items-center justify-center rounded-full bg-cta-500 px-6 py-3 text-sm font-semibold text-white no-underline hover:opacity-90"
              href={props.signInUrl}
            >
              {de.preview.dialog.action}
            </a>
          )}
          <Button variant="ghost" onClick={props.onDismiss}>
            {de.preview.dialog.dismiss}
          </Button>
        </div>
      </div>
    </div>
  );
}
