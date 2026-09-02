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

      {/*
        One row, and why that is a rule rather than a hope (DEP-24).

        The layout puts the percentage and the autosave note on one line, left
        and right. `flex-wrap` alone only *tends* to that: it keeps them
        together while they fit and drops the note underneath when they do not,
        and whether they fit is decided by a font this code does not choose.
        The widget renders in a customer's page with `--ds-font-family` set to
        whatever that customer licenses, so the same markup is one line for one
        deployment and two for the next. Measured at the card's `lg` width —
        512 px of content — the pair needs 505 px in Inter, 483 in Arial
        metrics and 560 in the DejaVu fallback a Linux browser without either
        would pick. The last of those wraps, and the first two clear it by
        7 px and 29 px: a card sized to the drawing is not a guarantee, it is
        a margin.

        `lg:flex-nowrap` makes the row a row at every one of those, and lets
        the note wrap *inside its own column* on the widths where the sentence
        will not fit beside the label. `min-w-0` is what permits that: a flex
        item's `min-width` is `auto`, so without it the note refuses to shrink
        below its longest line and overflows the card instead.

        Below `lg` the wrap stays, because the phone drawing
        (`player-ansicht-abgeschlossen.png`) stacks them too — at 288 px of
        content there is no row to have.

        The expiry line is the exception. It is three sentences, not four
        words, and squeezing it into what is left beside the label is how a
        message that says *your progress is no longer being saved* becomes four
        lines of small red text in a corner. It keeps the full width the wrap
        gives it.
      */}
      <div
        className={
          "mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1" +
          (props.status?.autosaveFailed === true ? "" : " lg:flex-nowrap")
        }
      >
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
          <p className="min-w-0 text-xs text-gray-500 lg:text-right">
            <SaveIcon />
            {de.player.autosave}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The floppy the layout puts before "Ihr Fortschritt wird automatisch
 * gespeichert" (P94-02).
 *
 * Decorative: the sentence beside it says the same thing in words, so a screen
 * reader announcing "Bild" here would add nothing. It earns its place visually
 * — the line is small grey text at the bottom of a card, and the glyph is what
 * makes a physician notice the reassurance at all.
 *
 * Inline rather than a flex sibling of the sentence (DEP-24). As a flex child
 * it kept its own column, so once the sentence wrapped — which it does at the
 * narrower card widths, right-aligned — the icon was left stranded in the
 * middle of the card beside nothing. Inline it sits at the head of the first
 * line and the rest of the sentence flows under it.
 */
function SaveIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mr-1.5 inline-block h-3.5 w-3.5 align-[-0.2em]"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2.5 2h8.7L14 4.8v8.7a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5Zm2 1v3.5h6V3h-6Zm-.5 6v4h8V9H4Z" />
    </svg>
  );
}
