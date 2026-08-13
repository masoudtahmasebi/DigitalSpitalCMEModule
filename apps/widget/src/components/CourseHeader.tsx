/**
 * The course-detail chrome from layout §4.2 — the hero, the metadata strip
 * under it, and the progress card.
 *
 * `StickyMetaBar` keeps its name for now because it is imported in several
 * places and renaming it is churn without a reader on the other side; the
 * "sticky" is historical, and the section below says why.
 *
 * ## The bar is no longer sticky
 *
 * It was, and the reasoning was sound on its own terms: the Übersicht tab runs
 * to several screens, and a resume button that scrolls off the top is a resume
 * button that is not there. It also had to be made fully opaque, because at
 * `bg-white/95` the tab row was legible sliding underneath it.
 *
 * The Zeplin layout does not have it stick — the meta strip sits under the hero
 * and scrolls away with it — and the layout is the source of truth for this
 * screen. What the sticky version was protecting is protected another way: the
 * teal "Ihr Fortschritt" card repeats beside all four tabs and carries the same
 * resume action, much further down the page than the bar ever reached.
 *
 * ## The meta strip overlaps the hero
 *
 * `-mt-7`, so the white card sits half over the teal block. That is the
 * layout's own device for tying the two into one masthead rather than stacking
 * two unrelated bands, and it is why the hero has no bottom padding to spare.
 *
 * ## Why the progress card repeats on every tab
 *
 * The layout puts it on all four, and that is not decoration: the Mediathek's
 * padlocks and the Zertifizierung tab's locked chapters are both consequences
 * of module completion, so the count that explains them belongs beside them.
 *
 * Neither component computes anything. `moduleCompletion`, `percent` and
 * `resumeContentId` are all the server's, and this file only arranges them.
 */

import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, CourseMetaBar, ProgressPanel } from "./primitives.js";

export function StickyMetaBar(props: {
  course: CourseDetail;
  state: EnrolmentState;
  /** Only rendered when the learner arrived through the catalogue. */
  onBack: (() => void) | undefined;
  onResume: (() => void) | undefined;
}) {
  const { course } = props;
  /**
   * "Starten" or "fortsetzen", decided by the server's own `status` (P68-02).
   *
   * It was `completedCount === 0`, which is a different question: a physician who
   * had watched half a module and come back the next evening was offered
   * **Fortbildung starten** — an invitation to begin something they were already
   * in the middle of, next to a panel saying "50 % der Videoinhalte angesehen".
   * Nothing was lost by pressing it, but the label was the one piece of the
   * screen that disagreed with the rest.
   *
   * `status` is `not_started | in_progress | completed`, decided by the API from
   * the same rollup everything else here renders — so the label now cannot
   * disagree with the progress beside it.
   */
  const resumeLabel =
    props.state.progress.status === "not_started"
      ? de.overview.start
      : de.overview.resume;

  return (
    <div className="mb-4">
      {/* Two panels side by side: the teal title block and the course artwork.
          The image is not decorative framing — it is the Titelbild the customer
          authored, and the layout gives it half the width.

          Below `sm` they are **stacked in the other order**, edge to edge, and
          square (P19-03). The mobile export runs the artwork full-bleed under
          the page header and puts the title on a teal band beneath it — the
          same two panels, rotated a quarter turn and swapped, which is why
          this is `flex-col-reverse` on one element rather than a second tree.

          `-mx-4` cancels the widget's own gutter so "full-bleed" is actually
          full-bleed; without it the artwork sits in a 16 px frame the drawing
          does not have. */}
      <div className="overflow-hidden rounded-2xl max-sm:-mx-4 max-sm:rounded-none">
        <div className="grid max-sm:flex max-sm:flex-col-reverse sm:grid-cols-2">
          <div className="flex items-center bg-brand-600 px-6 py-8 max-sm:px-4 sm:px-8 sm:py-12">
            <h1 className="break-words text-2xl font-bold leading-snug text-brand-contrast sm:text-3xl">
              {course.title}
            </h1>
          </div>

          {course.heroImageUrl === null ? (
            // No artwork: the teal block spans the full width rather than
            // sitting next to an empty grey rectangle.
            <div className="hidden bg-brand-600 sm:block" />
          ) : (
            <img
              src={course.heroImageUrl}
              alt=""
              className="w-full object-cover max-sm:h-[26rem] sm:h-full"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>

      <CourseMetaBar
        points={course.cmePoints === null ? null : String(course.cmePoints)}
        pointsLabel={de.overview.cmePoints}
        duration={
          course.totalDurationSec === 0 ? null : de.duration(course.totalDurationSec)
        }
        modules={de.overview.moduleCount(course.moduleCount)}
        action={
          props.onResume === undefined ? null : (
            <Button onClick={props.onResume}>{resumeLabel}</Button>
          )
        }
      />

      {props.onBack === undefined ? null : (
        <button
          type="button"
          onClick={props.onBack}
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-brand-700"
        >
          <span aria-hidden="true">←</span>
          {de.catalog.back}
        </button>
      )}
    </div>
  );
}

export function ProgressCard(props: {
  state: EnrolmentState;
  onResume: (() => void) | undefined;
}) {
  const { completed, total } = props.state.moduleCompletion;
  const sentence = de.overview.moduleProgress(completed, total);

  return (
    <>
      {/*
        Arc and caption are the same two numbers. Feeding the arc a percentage
        computed elsewhere is what let an earlier version draw a ring that
        disagreed with the sentence printed beside it.
      */}
      <ProgressPanel
        title={de.overview.title}
        completed={completed}
        total={total}
        value={de.overview.ringValue(completed, total)}
        sentence={sentence}
        footnote={de.overview.watchProgress(
          props.state.achievedWatchPercent,
          props.state.requiredWatchPercent,
        )}
        action={
          props.onResume === undefined ? null : (
            <Button variant="cta" onClick={props.onResume}>
              {props.state.progress.status === "not_started"
                ? de.overview.start
                : de.overview.resume}
            </Button>
          )
        }
      />

      {/*
        The banner tracks `courseComplete`, not `completedAt` (P51-01).

        A physician who has watched every video and passed the
        Lernerfolgskontrolle **has finished the Fortbildung**, and this is the
        screen that has to agree with them. It used to wait for `completedAt`,
        which additionally requires the Evaluationsbogen and the EFN — so the
        person who had just done all the actual work was shown no
        acknowledgement at all, only a form.

        The second line appears only in the gap between the two, and its whole
        job is to say where to go next.
      */}
      {props.state.courseComplete ? (
        <>
          <p className="mt-3 rounded-xl bg-green-50 px-4 py-2 text-center text-sm font-medium text-status-completed">
            {de.overview.complete}
          </p>
          {props.state.completedAt === null ? (
            <p className="mt-2 text-center text-sm text-gray-700">
              {de.overview.certificationOpen}
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
