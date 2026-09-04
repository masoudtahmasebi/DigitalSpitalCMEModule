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
import { CONTENT } from "../layout.js";
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
          authored, and the layout gives it exactly half the width — measured on
          the 1920 px export, the teal ends at x = 959.

          Below `sm` they are **stacked in the other order**, edge to edge, and
          square (P19-03). The mobile export runs the artwork full-bleed under
          the page header and puts the title on a teal band beneath it — the
          same two panels, rotated a quarter turn and swapped, which is why
          this is `flex-col-reverse` on one element rather than a second tree.

          ## Full-bleed, and square (P190-01)

          No inset and no rounding: the drawing runs both panels to the edges of
          the page on all four course pages. It was a rounded card inside the
          content column, which put a 16 px frame of page around artwork the
          layout has touching the edge — and left the heading starting at the
          card's inner padding rather than on the column's own left edge, where
          the meta strip and the tab row beneath it begin.

          This element is therefore **outside** the column: the caller renders
          it full width and the two things that must line up — the heading and
          the meta strip — each carry `CONTENT` of their own. A negative margin
          would not do it. `-mx-4` cancels 16 px of padding, not 261 px of
          centring, so inside a centred 1430 px column it bleeds by exactly the
          gutter and stops. */}
      <div className="overflow-hidden">
        <div className="grid max-sm:flex max-sm:flex-col-reverse sm:grid-cols-2">
          <div className="flex items-center bg-brand-600 py-8 max-sm:px-4 sm:py-24">
            {/*
              Half a content column, right-aligned in the hero's left half, so
              the heading's left edge is the column's left edge. `ml-auto` and
              a half-width max rather than `mx-auto` on a full one: this box
              only occupies the left half of the page, and centring a 1430 px
              column inside 960 px would put the text at the wrong edge.
            */}
            <div className="ml-auto w-full max-w-[715px] px-4 max-sm:px-0">
              <h1 className="break-words text-2xl font-bold leading-snug text-brand-contrast sm:text-[2.35rem] sm:leading-[1.25]">
                {course.title}
              </h1>
            </div>
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

      {/*
        Back inside the column. The strip and the back link line up with the
        tab row below them and with the heading above, all three on x = 261.
      */}
      <div className={CONTENT}>
        <CourseMetaBar
          points={course.cmePoints === null ? null : String(course.cmePoints)}
          pointsLabel={de.overview.cmePoints}
          duration={
            course.totalDurationSec === 0 ? null : de.duration(course.totalDurationSec)
          }
          modules={de.overview.moduleCount(course.moduleCount)}
          action={
            props.onResume === undefined ? null : (
              <Button size="lg" onClick={props.onResume}>
                {resumeLabel}
              </Button>
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
    </div>
  );
}

export function ProgressCard(props: {
  state: EnrolmentState;
  onResume: (() => void) | undefined;
  /**
   * The way to the Punktemeldung, when there is one (P168-03).
   *
   * `undefined` when the caller has nowhere to send them — the catalogue's
   * preview of a course nobody is enrolled in, and the tests that predate this.
   * The button is additionally withheld unless the *server* says the course is
   * complete and uncertified, which is the pair `POST /completion` accepts on:
   * §9.2, never offer what the API would refuse.
   */
  onClaimPoints?: (() => void) | undefined;
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
      {/*
        No watch-percentage line (DEP-30's sibling, DEP-32).

        It read "8 % der Videoinhalte angesehen (erforderlich: 100 %)" under the
        module count, and the client's review with Philipp removed it: the card
        answers one question — how many modules are done — and a second
        percentage measured against a different denominator beside it is two
        answers to "how far am I".

        The figure has not gone anywhere. The Zertifizierung tab states the
        requirement as an accreditation condition, and the player's own progress
        card reports coverage while a video is running, which is where a
        percentage of *video* belongs.

        `ProgressPanel`'s `footnote` stays in its signature: the panel is a
        primitive and this is one caller's decision, not the primitive's.
      */}
      <ProgressPanel
        title={de.overview.title}
        completed={completed}
        total={total}
        value={de.overview.ringValue(completed, total)}
        sentence={sentence}
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
            <>
              <p className="mt-2 text-center text-sm text-gray-700">
                {de.overview.certificationOpen}
              </p>
              {/*
                The control the sentence used to describe (P168-03).

                Until now this state was a paragraph naming the Zertifizierung
                tab, and the form is not on that tab — so the one screen that
                knew a physician had finished told them to go somewhere the
                thing they wanted was not. The Punktemeldung was reachable only
                by sitting the exam again, which is the client's report and also
                the wrong act: passing it a second time is not what they came
                back for.
              */}
              {props.onClaimPoints === undefined ? null : (
                <div className="mt-3 flex justify-center">
                  <Button variant="cta" onClick={props.onClaimPoints}>
                    {de.overview.claim}
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
