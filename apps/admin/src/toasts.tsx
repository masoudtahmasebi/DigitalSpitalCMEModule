/**
 * Every API failure says something, without every screen having to (P205-01).
 *
 * ## Why this exists
 *
 * The client deleted a course, the API refused it with a 409 and a written
 * German reason, and the console showed nothing at all. They asked the question
 * that matters more than the bug: *"is that the same case for other entities?
 * how is the error handling for the api errors in the whole application?"*
 *
 * The audit answer (P202) was that the erasure was unique but the shape was
 * not: 48 `describeError` call sites across 19 files, each screen owning its
 * own channel, and each channel a decision somebody made once. A screen that
 * forgets one — or reports into a state the next reload clears — is silent, and
 * nothing anywhere says so.
 *
 * ## Why the wrapper and not 48 call sites
 *
 * Rewiring every screen would be 48 chances to miss one, and the 49th would be
 * written next week with no channel at all. Both console clients are built by
 * one function, so a failure is observable in **one** place — and a net under
 * every request cannot be forgotten by a screen that has not been written yet.
 *
 * Screens keep their inline messages. Those carry context a transient toast
 * cannot — which field, beside which form — and this is the floor, not a
 * replacement: *something* is always said.
 *
 * ## What it deliberately does not announce
 *
 * `401` and `403` are routed by the console already, to the login form and the
 * "you are not an admin" screen. Toasting them would put a disappearing message
 * over a screen whose whole job is to explain the same thing, and a 403 while
 * probing what a role may see is not news.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { de } from "./locale/de.js";

export type Toast = { readonly id: number; readonly text: string };

type Publish = (text: string) => void;

const ToastContext = createContext<Publish>(() => undefined);

/** How long a toast stays. Long enough to read a sentence and a reference id. */
const DISMISS_AFTER_MS = 12_000;

export function useToasts(): Publish {
  return useContext(ToastContext);
}

export function ToastProvider(props: {
  publishRef: { current: Publish };
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((toast) => toast.id !== id));
  }, []);

  const publish = useCallback<Publish>(
    (text) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((all) => {
        /*
         * The same sentence twice is one problem happening twice, and two
         * stacked copies of it read as two problems. A screen that retries on a
         * timer would otherwise fill the corner.
         */
        if (all.some((toast) => toast.text === text)) return all;
        return [...all, { id, text }];
      });
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  /*
   * The client is built before this provider renders — it is a plain function,
   * not a component — so the publisher reaches it through a ref the shell owns.
   * A context alone cannot: `staffClient` has no hooks.
   */
  props.publishRef.current = publish;

  return (
    <ToastContext.Provider value={publish}>
      {props.children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastHost(props: { toasts: readonly Toast[]; onDismiss: (id: number) => void }) {
  if (props.toasts.length === 0) return null;

  return (
    /*
     * `aria-live="assertive"` and `role="alert"` on each: a failed action is
     * not an ambient update, and the person it happened to may have their
     * focus on the control that caused it.
     *
     * Bottom-right and fixed, above everything — a message that scrolls away
     * with the page is a message about something that already happened.
     */
    <div
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:max-w-md"
    >
      {props.toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="pointer-events-auto w-full rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{toast.text}</span>
            <button
              type="button"
              className="shrink-0 rounded font-medium underline underline-offset-2"
              onClick={() => props.onDismiss(toast.id)}
            >
              {de.common.dismiss}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
