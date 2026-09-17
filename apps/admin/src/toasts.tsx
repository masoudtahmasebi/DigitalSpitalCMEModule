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

/**
 * What a toast is about, and it decides three things at once (P238-01).
 *
 * Until now there was one kind, because there was one publisher and it
 * published failures. A success is not a quieter failure — it is announced
 * differently, it is read for less time, and it must not interrupt somebody
 * mid-sentence — so the tone travels with the message rather than being a skin
 * chosen at the end.
 */
export type ToastTone = "error" | "success";

export type Toast = {
  readonly id: number;
  readonly text: string;
  readonly tone: ToastTone;
};

export type Publish = (text: string, tone: ToastTone) => void;

const ToastContext = createContext<Publish>(() => undefined);

/**
 * How long each kind stays.
 *
 * A failure holds for twelve seconds because it carries a sentence *and* a
 * reference id somebody may want to copy into a mail. A confirmation carries
 * neither — it says the thing you just did worked, and it is read in the
 * moment or not at all. Five seconds is long enough to notice and short enough
 * not to sit over the next form.
 */
const DISMISS_AFTER_MS: Record<ToastTone, number> = {
  error: 12_000,
  success: 5_000,
};

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
    (text, tone) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((all) => {
        /*
         * The same sentence twice is one problem happening twice, and two
         * stacked copies of it read as two problems. A screen that retries on a
         * timer would otherwise fill the corner.
         *
         * Matched on the text **and** the tone, since P238-01. The two cases
         * are not symmetrical and the tone is what tells them apart: two
         * identical failures are one problem reported twice, but saving two
         * modules in a row genuinely is two confirmations of "Gespeichert." and
         * suppressing the second would leave the operator looking at a message
         * about the previous action. What the dedupe is for is a screen
         * hammering one message, and a repeat within five seconds of an
         * identical *success* is the same event — so the rule stays, and only
         * the key widens.
         */
        if (all.some((toast) => toast.text === text && toast.tone === tone)) return all;
        return [...all, { id, text, tone }];
      });
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS[tone]);
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

  /*
   * **Two live regions, not one** (P238-01).
   *
   * A live region's urgency is a property of the *region*, not of the nodes
   * put into it, so a single `aria-live="assertive"` container announces a
   * confirmation the same way it announces a refusal — interrupting whatever
   * the screen reader was saying to report that a save worked. Splitting them
   * is the only way both can be right.
   *
   * The two are stacked in one fixed wrapper so they read as one column on
   * screen. Errors are rendered **last** and therefore sit lowest, nearest the
   * corner the eye returns to; a confirmation pushed an error upward would be
   * the less important message taking the better position.
   *
   * Bottom-right and fixed, above everything — a message that scrolls away
   * with the page is a message about something that already happened.
   */
  const byTone = (tone: ToastTone) => props.toasts.filter((toast) => toast.tone === tone);

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:max-w-md">
      {/*
        Polite: a confirmation waits for a pause. The operator pressed the
        button and is not in doubt that something happened — this tells them it
        worked, and it can wait a sentence to do so.
      */}
      <Region
        toasts={byTone("success")}
        live="polite"
        role="status"
        onDismiss={props.onDismiss}
      />
      {/*
        Assertive: a failed action is not an ambient update, and the person it
        happened to may have their focus on the control that caused it.
      */}
      <Region
        toasts={byTone("error")}
        live="assertive"
        role="alert"
        onDismiss={props.onDismiss}
      />
    </div>
  );
}

/**
 * One live region and the toasts currently in it.
 *
 * Rendered even when empty — that is the point of a live region rather than an
 * accident. A region inserted into the document *together with* its first
 * message is not reliably announced, because assistive technology has to be
 * observing the region before the change happens. `ToastHost` returning `null`
 * for an empty list is safe only because both regions then appear at once and
 * the first message arrives in the same commit as the region that holds it —
 * which is the case this file has always had, and is why the empty-list guard
 * is above rather than here.
 */
function Region(props: {
  toasts: readonly Toast[];
  live: "polite" | "assertive";
  role: "status" | "alert";
  onDismiss: (id: number) => void;
}) {
  return (
    <div aria-live={props.live} className="flex w-full flex-col items-end gap-2">
      {props.toasts.map((toast) => (
        <div
          key={toast.id}
          role={props.role}
          className={`pointer-events-auto w-full rounded-lg border p-3 text-sm shadow-lg ${
            toast.tone === "success"
              ? // The same green as `Notice tone="success"`. An operator who
                // sees a confirmation inline on one screen and as a toast on
                // the next is looking at one idea, not two.
                "border-green-200 bg-green-50 text-green-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
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
