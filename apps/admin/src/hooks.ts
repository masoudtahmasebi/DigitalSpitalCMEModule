/**
 * The two pieces of state every authoring screen needs (P9-02, P9-04, P9-05).
 *
 * Six screens save something and five of them load a list first. Written out
 * per screen that is six copies of the same `setBusy(true) / try / catch /
 * finally` — and the copies drift: one forgets to clear the previous error, one
 * leaves the button enabled during the request and double-submits, one shows
 * "gespeichert" after a failure.
 *
 * ## "So it lives here once" was not true, and that sentence is why
 *
 * It said so from P9-02 until P230-01, while **six screens went on
 * hand-rolling the triplet** and seven used this. The prediction above came
 * true in the meantime and on the write where it mattered most: the learner
 * name correction had no `busy` guard at all, so Speichern stayed live for the
 * whole round trip and three clicks sent three corrections — each writing its
 * own `learner.name_corrected` row into the append-only audit log.
 *
 * A comment asserting completeness is the reason nobody looks (§11.9), so this
 * one now claims only what `scripts/check-savers.mjs` enforces: a component
 * that performs an admin mutation uses this hook, or says in a comment why it
 * does not.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { describeError, isRetryable } from "./api.js";
import { de } from "./locale/de.js";

export type SaveState = "idle" | "saving" | "saved";

export interface Saver {
  readonly state: SaveState;
  readonly problem: string | undefined;
  /**
   * Run a mutation. Resolves `true` when it succeeded, so a caller can decide
   * what to do next — close the form, clear a draft — without repeating the
   * error handling.
   */
  readonly run: (action: () => Promise<unknown>) => Promise<boolean>;
  readonly reset: () => void;
}

/**
 * @param fallback the sentence to show when the API sent no `detail` of its
 * own. Defaults to `de.error.generic`, which is right for a screen with no
 * better words; a screen that has them should pass them, because "Es ist ein
 * Fehler aufgetreten" tells an operator nothing about which of their twenty
 * fields the server disliked.
 *
 * It is a fallback and never a replacement: where the API wrote a `detail` —
 * a refused name correction explains that the Punktemeldung has already gone
 * and what to do instead — that sentence still wins, because paraphrasing it
 * would throw away the only actionable part.
 */
export function useSaver(fallback: string = de.error.generic): Saver {
  const [state, setState] = useState<SaveState>("idle");
  const [problem, setProblem] = useState<string | undefined>();
  const alive = useMounted();

  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setProblem(undefined);
      setState("saving");
      try {
        await action();
        if (alive.current) setState("saved");
        return true;
      } catch (error) {
        if (alive.current) {
          // The API's `detail` where it wrote one — a refused delete says how
          // many learner records are in the way, and paraphrasing that into a
          // generic sentence would throw away the only actionable part.
          setProblem(describeError(error, fallback));
          setState("idle");
        }
        return false;
      }
    },
    [alive, fallback],
  );

  const reset = useCallback(() => {
    setState("idle");
    setProblem(undefined);
  }, []);

  return { state, problem, run, reset };
}

/**
 * Loads once per changing key, and hands back a setter so a screen that saves
 * can adopt the response instead of re-fetching.
 *
 * That last part matters more than it looks: every authoring mutation returns
 * the whole `CourseStructure`, and a screen that re-fetched after saving would
 * briefly render the pre-save tree.
 */
export function useLoaded<T>(load: () => Promise<T>): [
  T | undefined,
  (value: T) => void,
  string | undefined,
  () => void,
  /**
   * Whether retrying the load could produce a different answer (P231-02).
   * `true` while nothing has failed, so a caller can pass it straight to
   * `LoadFailure` without a null check.
   */
  boolean,
] {
  const [value, setValue] = useState<T | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [retryable, setRetryable] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const alive = useMounted();

  useEffect(() => {
    setProblem(undefined);
    setRetryable(true);
    load().then(
      (loaded) => {
        if (alive.current) setValue(loaded);
      },
      (error: unknown) => {
        if (!alive.current) return;
        setProblem(describeError(error, de.error.generic));
        /*
         * Set from the same error as the sentence, in the same place. Two
         * reads of one value is §4 invariant 6, and the failure mode here is
         * particular: a screen that computed the sentence from the error and
         * the affordance from something else would eventually say "this no
         * longer exists" above a button offering to look for it again.
         */
        setRetryable(isRetryable(error));
      },
    );
    // `attempt` is the retry trigger; `load` is expected to be a useCallback.
  }, [load, attempt, alive]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [value, setValue, problem, retry, retryable];
}

/**
 * Whether the component is still mounted.
 *
 * An admin who clicks into a course and straight back out again would
 * otherwise have the in-flight response call `setState` on an unmounted tree.
 */
function useMounted(): { readonly current: boolean } {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/**
 * A form with unsaved edits says so before the operator loses them (P234-01).
 *
 * ## The defect
 *
 * Nothing in the console guarded an in-progress edit. Clicking a navigation
 * link discarded it, and so did a reload or a closed tab — silently, in every
 * case. `grep -rn "beforeunload" apps/admin/src` returned nothing.
 *
 * The worst instance is the project settings form in `Organisation`: twenty-odd
 * fields including SMTP host, port, username, password, sender address and the
 * whole branding object. An operator part-way through configuring a customer's
 * mail who clicks **Fortbildungen** loses all of it and is told nothing.
 *
 * `QuizEditor` is the only screen that ever mentioned this, and only as a
 * passive amber note beside a button — it warns, it does not guard.
 *
 * ## Why this is a registry and not a prop
 *
 * The thing that has to ask "is anything unsaved?" is the **navigation**, which
 * lives in `Console` and knows nothing about the screen it is about to replace.
 * Threading a callback from ten forms up through `Shell` would put the same
 * fact in ten places, which is §4 invariant 6 and §9.10b.
 *
 * So a form declares its own state and the registry answers one question for
 * everybody. A module-level `Set` rather than a context: the answer is needed
 * inside an event handler, not during a render, and a context read would make
 * every form re-render whenever any other form changed.
 *
 * ## Why every form, and not just the big ones
 *
 * A guard that fires on some screens and not others is worse than none. It
 * teaches the operator that the console warns them, and then one day it does
 * not — which is §9.2's shape: an affordance that looks like a decision. The
 * adoption cost was measured before this was written: every form can express
 * dirtiness as one comparison against what it loaded.
 */
const unsaved = new Set<string>();

/** Whether any mounted form is holding edits the server has not seen. */
export function hasUnsavedChanges(): boolean {
  return unsaved.size > 0;
}

/**
 * Exported for tests, which would otherwise leak a registration between cases —
 * §9.8's "reset every ambient store in `afterEach`, not only the one that
 * broke", and this is a module-level `Set`, which is exactly that kind of store.
 */
export function forgetUnsavedChanges(): void {
  unsaved.clear();
}

/**
 * Declare whether this form is holding unsaved edits.
 *
 * `id` identifies the form, so two mounted at once are counted separately and
 * unmounting one does not clear the other's flag.
 */
export function useUnsavedChanges(id: string, dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      unsaved.delete(id);
      return;
    }
    unsaved.add(id);

    /*
     * The browser's own guard, for the half of the problem no router can see:
     * a reload, a closed tab, a typed URL. The text is the browser's — every
     * engine ignores whatever a page supplies and shows its own sentence — so
     * `preventDefault` is the whole API and inventing copy here would be copy
     * nobody ever reads.
     */
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      unsaved.delete(id);
      window.removeEventListener("beforeunload", warn);
    };
  }, [id, dirty]);
}
