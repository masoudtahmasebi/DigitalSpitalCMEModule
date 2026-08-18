/**
 * The progress card the layout draws in the teal masthead (P93-03).
 *
 * `Player-Ansicht-*` puts it top-right, overlapping the teal band and the white
 * panel below it: the module position, the media clock, one bar for the whole
 * course, the percentage and the autosave line. It used to sit inside the white
 * panel above the video — every element correct, in the wrong place — which is
 * the half of the client's report that says *"the screen is completely
 * different to the design"*.
 *
 * ## What it will and will not say
 *
 * The bar is `state.progress.percent`, the **server's** course figure, and
 * never the video's own position — the clock beside it already says that, and
 * drawing the playhead here would put two different quantities on one strip.
 *
 * The clock is absent for a screen with no media, which is every exam page.
 * The card stays, because "Modul 3 von 5" and the course bar are true there
 * too, and a card that vanished between the video and the exam would read as a
 * lost place rather than a different screen.
 *
 * `courseProgress` names the quantity rather than showing the layout's bare
 * "63% absolviert" — S16 in `docs/show-stoppers.md`, kept from #61: the
 * drawing's referent is not derivable from the drawing, and a number a learner
 * will trust is not a thing to guess at (§7).
 */

import { clockTime } from "@ds/domain";
import type { EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import type { PlayerStatus } from "../player-status.js";

export function PlayerProgressCard(props: {
  state: EnrolmentState;
  /** Where in the course the learner is, when the screen knows. */
  moduleIndex: number | undefined;
  moduleCount: number;
  status: PlayerStatus | undefined;
}) {
  const percent = props.state.progress.percent;

  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        {props.moduleIndex === undefined ? (
          <span />
        ) : (
          <p className="font-bold text-gray-900">
            {de.player.moduleOf(props.moduleIndex + 1, props.moduleCount)}
          </p>
        )}

        {props.status?.position === undefined ? null : (
          <p className="tabular-nums text-gray-700">
            <span className="sr-only">{de.player.positionLabel}: </span>
            {de.player.position(
              clockTime(props.status.position.positionSec),
              clockTime(props.status.position.durationSec),
            )}
          </p>
        )}
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={de.player.courseProgress(percent)}
      >
        <div
          className="h-full rounded-full bg-brand-600"
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold text-brand-700">
          {de.player.courseProgress(percent)}
        </p>
        {/*
          The autosave promise, or the truth (P62-05).

          "Ihr Fortschritt wird automatisch gespeichert" is a promise, and once
          the session has lapsed it is a false one that stays on screen for as
          long as the physician keeps watching. QA measured a 60-second token
          against a module playing on: every flush from expiry onwards refused,
          and this line never changed.
        */}
        {props.status?.autosaveFailed === true ? (
          <p className="text-xs font-semibold text-red-700">{de.player.sessionEnded}</p>
        ) : (
          <p className="text-xs text-gray-500">{de.player.autosave}</p>
        )}
      </div>
    </section>
  );
}
