/**
 * The floating progress module (P19-01).
 *
 * ## Why this exists
 *
 * It is the only screen in the mobile set that adds behaviour rather than
 * rearranging it, and it exists because the wide layout's progress card has
 * nowhere to go on a 430 px screen. That card is the module count, the watch
 * percentage and the resume button; stacked at phone width it costs a third of
 * the viewport, on pages whose whole purpose is a video.
 *
 * So the layout collapses it to one tappable dot that floats over the page,
 * and **Fortbildung fortsetzen** — which P15-04 made a real destination rather
 * than a label — is what the dot opens onto. On the device most learners will
 * use, this *is* the resume affordance.
 *
 * ## What it is not
 *
 * Not a second source of truth. Every number here comes from the same
 * `EnrolmentState` the inline card reads, which only ever arrives from the API.
 * The client is a renderer; a floating widget that computed its own progress
 * would be a second answer to a question that decides a CME point.
 *
 * ## Why the heading is a button
 *
 * The drawing shows the open card with no close control — a teal panel whose
 * first line is "Ihr Fortschritt". A floating panel that cannot be dismissed is
 * a floating panel over the player's controls, so something has to close it.
 * Rather than adding an X the layout does not have, the heading itself is the
 * toggle: it looks exactly as drawn, and it is operable by touch, by keyboard
 * and by a screen reader. Escape closes it too, because that is what a
 * dismissible overlay owes a keyboard.
 */

import { useEffect, useRef, useState } from "react";
import type { EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, ProgressRing } from "./primitives.js";

export function StickyProgress(props: {
  state: EnrolmentState;
  onResume: (() => void) | undefined;
  /**
   * The way to the Punktemeldung, when there is one (P168-03).
   *
   * The inline `ProgressCard` is `max-sm:hidden` and this panel is what
   * replaces it, so a button added only there is a button no phone has. That
   * is the responsive floor doing its job as a rule rather than as a review
   * comment.
   */
  onClaimPoints?: (() => void) | undefined;
  /** The finished Punktemeldung's affordance (P195-02). */
  onOpenCertificate?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openRef = useRef<HTMLButtonElement | null>(null);
  /** False until the learner has opened it once, so the first render does not
   *  steal focus from wherever they actually were. */
  const opened = useRef(false);

  const { completed, total } = props.state.moduleCompletion;
  const sentence = de.overview.moduleProgress(completed, total);

  /*
   * Escape closes it. A floating panel over a video that a keyboard cannot
   * dismiss is a floating panel that stays there.
   */
  useEffect(() => {
    if (!open) return undefined;

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }

    // The widget lives in a shadow root, but key events bubble out of it, so
    // the document is the right listener host and there is only ever one.
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /*
   * Focus follows the disclosure, in both directions.
   *
   * Opening puts a keyboard user inside the thing they just opened rather than
   * behind it; closing puts them back on the control that opened it, because
   * otherwise focus is on an element that no longer exists and the next Tab
   * starts from the top of the document — a long way from where they were on a
   * course page.
   *
   * It has to be an effect, not a line in the click handler: the button being
   * focused does not exist yet at the moment the state changes. Whichever
   * branch is rendering has just been unmounted.
   */
  useEffect(() => {
    if (open) {
      opened.current = true;
      closeRef.current?.focus();
    } else if (opened.current) {
      openRef.current?.focus();
    }
  }, [open]);

  return (
    /*
     * `sm:hidden`: the wide layout has the inline card, and two progress
     * panels on one screen would be two places to read the same number —
     * which is how they end up disagreeing.
     *
     * `fixed`, not `sticky`: it floats over the page rather than over one
     * scrolling container, and inside a Shadow DOM inside a WordPress theme
     * there is no container it could reliably stick to.
     *
     * Bottom-right, clear of the edge. `pb-[env(safe-area-inset-bottom)]`
     * because on an iPhone the bottom of the viewport is the home indicator,
     * and a button under it is a button that scrolls the page instead.
     */
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 pb-[env(safe-area-inset-bottom)] sm:hidden">
      {open ? (
        /*
         * The open card is the closed teardrop grown up, and it keeps the
         * teardrop's corner (DEP-29).
         *
         * `progress-sticky-module.png` is a 2× export of a 430 px frame, which
         * is checkable rather than assumed: the card measures 560 px across in
         * it and `w-[17.5rem]` below is 280. At that scale its corners are
         * 20 px on three sides and **square on the top-right** — the same shape
         * as the button it opens from, the inline `ProgressPanel` and every
         * tab. It was `rounded-3xl` on all four, which is both 4 px too round
         * and one corner too many.
         */
        <section
          aria-label={de.overview.title}
          className="pointer-events-auto w-[17.5rem] rounded-[1.25rem] rounded-tr-none bg-brand-600 p-5 text-center text-brand-contrast shadow-2xl"
        >
          <button
            ref={closeRef}
            type="button"
            aria-expanded="true"
            onClick={() => {
              setOpen(false);
            }}
            /*
              The layout draws a heading, so it should read as one — but it is
              a control and a keyboard user has to be able to see where they
              are. `focus-visible` rather than `focus`: the browser shows the
              indicator for a keyboard and withholds it for a thumb, which is
              the distinction the two states exist for.

              An **outline**, not a ring, and this is the part that was wrong.
              It read `outline-none focus-visible:ring-2 ring-white/80`, which
              cannot work here: `.outline-none` is one class (0,1,0) and
              `styles.css`'s a11y floor is `.ds-lms-root :focus-visible`
              (0,2,0), so the floor won and drew its own 2 px `--ds-accent`
              rectangle — dark blue, on a teal card, at 2 px offset, *plus* the
              white ring underneath it. Focus lands here programmatically the
              moment the card opens, so nobody had to press a key to see it.
              Matching the floor's own idiom (`focus-visible:outline-*`, as the
              player already does) ties the specificity and lets source order
              decide, which is what the reordering in `styles.css` is for.
            */
            className="w-full rounded-lg text-lg font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {de.overview.title}
          </button>

          <div className="mt-3 flex justify-center">
            <ProgressRing
              completed={completed}
              total={total}
              value={de.overview.ringValue(completed, total)}
              label={sentence}
              tone="onBrand"
            />
          </div>

          <p className="mt-3 text-sm leading-snug">{sentence}</p>

          {/*
            No watch-percentage footnote, unlike the inline card. The drawing
            does not have one, and the panel is 280 px wide over a video — a
            second sentence there is the difference between a glance and a
            paragraph.
          */}

          {props.onResume === undefined ? null : (
            <div className="mt-4">
              <Button variant="cta" onClick={props.onResume}>
                {props.state.progress.status === "not_started"
                  ? de.overview.start
                  : de.overview.resume}
              </Button>
            </div>
          )}

          {/*
            Finished, uncertified: the same act the inline card offers, on the
            panel that stands in for it below `sm` (P168-03). Both are gated on
            the server's `courseComplete`, so neither can offer a completion the
            API would refuse.
          */}
          {props.state.courseComplete &&
          props.state.completedAt === null &&
          props.onClaimPoints !== undefined ? (
            <div className="mt-3">
              <Button variant="cta" onClick={props.onClaimPoints}>
                {de.overview.claim}
              </Button>
            </div>
          ) : null}
          {/*
            The step's done state (P195-02). It navigates to the Zertifizierung
            tab rather than downloading, for the reason `CourseHeader` gives at
            length: this panel is on the course detail too, where a second
            "herunterladen" would collide with `CertificatePanel`'s own.

            Gated on the prop alone — `App` decides when a certificate exists,
            and a second reading of `completedAt` here is what made the same
            block in `CourseHeader` impossible to test.
          */}
          {props.onOpenCertificate === undefined ? null : (
            <div className="mt-3">
              <Button onClick={props.onOpenCertificate}>
                {de.catalog.toCertificate}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <button
          ref={openRef}
          type="button"
          aria-expanded="false"
          // The sentence, not "Fortschritt": a screen reader reading a button
          // called "Fortschritt" learns nothing it did not already suspect.
          aria-label={sentence}
          onClick={() => {
            setOpen(true);
          }}
          /*
           * The teardrop: a disc with its top-right corner square, which is
           * the shape the layout draws and the same one the hero's
           * bottom-right corner uses at the other scale.
           */
          className="pointer-events-auto flex h-[4.4rem] w-[4.4rem] items-center justify-center rounded-full rounded-tr-none bg-brand-600 text-brand-contrast shadow-xl"
        >
          <ClosedRing completed={completed} total={total} />
        </button>
      )}
    </div>
  );
}

/**
 * The ring on the closed button: solid for what is done, dashed for what is
 * not.
 *
 * Its own small SVG rather than `ProgressRing`, because that one carries a
 * centre label and an accessible name, and both would be wrong here — the
 * button already has the sentence as its name, and a number legible at 34 px
 * would crowd out the ring that is the point.
 *
 * `aria-hidden`, for the same reason.
 */
function ClosedRing(props: { completed: number; total: number }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(0, props.total);
  const done = total === 0 ? 0 : Math.min(Math.max(props.completed, 0), total) / total;

  return (
    <svg viewBox="0 0 34 34" className="h-9 w-9" aria-hidden="true">
      {/* What is left, dashed. */}
      <circle
        cx="17"
        cy="17"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.75"
        strokeWidth="3.5"
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      {/* What is done, solid, drawn from twelve o'clock. */}
      <circle
        cx="17"
        cy="17"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${circumference * done} ${circumference}`}
        transform="rotate(-90 17 17)"
      />
    </svg>
  );
}
