/**
 * The two pieces of state every authoring screen needs (P9-02, P9-04, P9-05).
 *
 * Six screens save something and five of them load a list first. Written out
 * per screen that is six copies of the same `setBusy(true) / try / catch /
 * finally` — and the copies drift: one forgets to clear the previous error, one
 * leaves the button enabled during the request and double-submits, one shows
 * "gespeichert" after a failure. So it lives here once.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "./api.js";
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

export function useSaver(): Saver {
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
          setProblem(describeError(error, de.error.generic));
          setState("idle");
        }
        return false;
      }
    },
    [alive],
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
export function useLoaded<T>(
  load: () => Promise<T>,
): [T | undefined, (value: T) => void, string | undefined, () => void] {
  const [value, setValue] = useState<T | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const alive = useMounted();

  useEffect(() => {
    setProblem(undefined);
    load().then(
      (loaded) => {
        if (alive.current) setValue(loaded);
      },
      (error: unknown) => {
        if (alive.current) setProblem(describeError(error, de.error.generic));
      },
    );
    // `attempt` is the retry trigger; `load` is expected to be a useCallback.
  }, [load, attempt, alive]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return [value, setValue, problem, retry];
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
