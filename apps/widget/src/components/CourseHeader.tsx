/**
 * The course-detail chrome from layout §4.2 — the sticky metadata bar and the
 * progress card.
 *
 * ## Why the bar is sticky
 *
 * Opaque, not translucent. It was `bg-white/95` with a `backdrop-blur`, and on
 * a running page the tab row and the progress panel were plainly legible
 * sliding underneath it — five per cent is not much, but it is enough to read,
 * and it looks like a rendering fault rather than a design. A bar that content
 * passes behind has to hide it.
 *
 * It carries the two things a learner needs from anywhere on a long page: what
 * the course is worth, and the way back into it. The Übersicht tab alone runs
 * to several screens of Beschreibung, Lernziele and a module list, and a resume
 * button that scrolls off the top is a resume button that is not there.
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
import { Button, ProgressRing } from "./primitives.js";

export function StickyMetaBar(props: {
  course: CourseDetail;
  state: EnrolmentState;
  /** Only rendered when the learner arrived through the catalogue. */
  onBack: (() => void) | undefined;
  onResume: (() => void) | undefined;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 mb-2 border-b border-gray-200 bg-white px-4 py-3">
      {props.onBack === undefined ? null : (
        <button
          type="button"
          onClick={props.onBack}
          className="text-sm font-medium text-brand-700 underline"
        >
          {de.catalog.back}
        </button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-gray-900">
            {props.course.title}
          </h1>
          <p className="text-sm text-gray-600">{de.catalog.cardMeta(props.course)}</p>
        </div>

        {props.onResume === undefined ? null : (
          <Button onClick={props.onResume}>
            {props.state.progress.completedCount === 0
              ? de.overview.start
              : de.overview.resume}
          </Button>
        )}
      </div>
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
    <section
      aria-label={de.overview.title}
      className="flex flex-wrap items-center gap-4 rounded-[var(--ds-radius)] border border-gray-200 bg-gray-50 p-4"
    >
      {/*
        Arc and caption are the same two numbers. Feeding the arc a percentage
        computed elsewhere is what let an earlier version draw a ring that
        disagreed with the sentence printed beside it.
      */}
      <ProgressRing
        completed={completed}
        total={total}
        value={de.overview.ringValue(completed, total)}
        label={sentence}
      />

      <div className="min-w-0 flex-1 space-y-1 text-sm text-gray-700">
        <p className="font-semibold text-gray-900">{de.overview.title}</p>
        <p>{sentence}</p>
        <p className="text-gray-600">
          {de.overview.watchProgress(
            props.state.achievedWatchPercent,
            props.state.requiredWatchPercent,
          )}
        </p>
        {props.state.completedAt === null ? null : (
          <p className="font-medium text-status-completed">{de.overview.complete}</p>
        )}
      </div>

      {props.onResume === undefined ? null : (
        <Button onClick={props.onResume}>
          {props.state.progress.completedCount === 0
            ? de.overview.start
            : de.overview.resume}
        </Button>
      )}
    </section>
  );
}
