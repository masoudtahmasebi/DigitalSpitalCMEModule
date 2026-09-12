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
