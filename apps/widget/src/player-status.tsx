/**
 * What the player tells the chrome around it (P93-03).
 *
 * ## Why a context and not a prop
 *
 * `Player-Ansicht-*` draws two things the player owns in places the player does
 * not render: the **progress card** in the teal masthead beside the course
 * title, and the **primary action** under the module list in the sidebar. Both
 * of those belong to `CourseShell`, which is the player's *parent* — it takes
 * the screen as `children`.
 *
 * So the values have to travel up. The alternatives were worse:
 *
 * - lifting the playback clock into `App.tsx` would re-render the whole course
 *   subtree — sidebar, tabs, summary — four times a second, on the one screen a
 *   physician spends half an hour on;
 * - a second progress card in the header, fed from `state`, would be two
 *   readings of the same numbers, which is the shape §4 invariant 6 exists to
 *   forbid and which P68-02 was.
 *
 * ## Why the setter is its own context
 *
 * `CourseShell` holds the status and passes **only the setter** down here. The
 * setter from `useState` is stable, so a status change re-renders `CourseShell`
 * — which redraws the card — while `props.children` keeps its element identity
 * and React skips the player's subtree entirely. Putting the value in the same
 * context would re-render every consumer on every `timeupdate`, which is the
 * cost this arrangement exists to avoid.
 *
 * A screen that reports nothing leaves the card showing the course figures
 * without a clock and the sidebar without an action, which is what the layout
 * draws for the exam pages.
 */

import { createContext, useContext, useEffect } from "react";

/** The one control the layout draws under the module list. */
export interface PlayerAction {
  readonly label: string;
  readonly variant: "primary" | "cta";
  readonly disabled: boolean;
  readonly run: () => void;
}

export interface PlayerStatus {
  /** The media clock, or undefined for a section that has no media. */
  readonly position:
    { readonly positionSec: number; readonly durationSec: number } | undefined;
  /** True once the session has lapsed and nothing more will be credited (P62-05). */
  readonly autosaveFailed: boolean;
  readonly action: PlayerAction | undefined;
}

export type ReportPlayerStatus = (status: PlayerStatus | undefined) => void;

const noop: ReportPlayerStatus = () => undefined;

export const PlayerStatusContext = createContext<ReportPlayerStatus>(noop);

/**
 * Report this screen's status to the chrome, and clear it on the way out.
 *
 * The clear is the load-bearing half: without it, leaving the player for the
 * Lernerfolgskontrolle would leave a stale "14:35 / 25:45" and a stale
 * **Fortbildung pausieren** in a shell whose screen no longer has either.
 *
 * `deps` is the caller's, because the status carries a closure — `run` has to
 * see the current handlers, and re-reporting on every render would set state
 * during render and loop.
 */
export function useReportPlayerStatus(
  build: () => PlayerStatus,
  deps: readonly unknown[],
): void {
  const report = useContext(PlayerStatusContext);

  /*
   * `build` is deliberately not a dependency, and the spread is deliberate too.
   *
   * `build` closes over the screen's current handlers and is a new function on
   * every render, so depending on it would report — and therefore set state in
   * the ancestor — on every render, which is a loop. The caller lists the
   * primitives its status is derived from instead, which is the same contract
   * `useMemo` has with a caller that builds an object.
   *
   * The lint rule cannot see through that and says so; the alternative it wants
   * is a `useCallback` in every caller with the same list, one level further
   * away from the values it is about.
   */
  useEffect(() => {
    report(build());
    return () => report(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, ...deps]);
}
