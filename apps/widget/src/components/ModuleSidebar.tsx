/**
 * The player's **Modul Übersicht** sidebar (layout §4.3).
 *
 * Modules expand to their chapters, each row carrying one of the four state
 * glyphs the layout specifies — completed, in progress, locked, paused.
 *
 * ## One addition to the layout, and why
 *
 * The layout shows two levels; this renders three, listing a chapter's contents
 * beneath it. The widget navigates by *content*, not by chapter — a chapter is
 * a heading over one or more videos — so a two-level sidebar would either be
 * unclickable or would have to invent a rule for which content a chapter click
 * opens. Guessing that rule would put the learner in the wrong video. The
 * contents are shown only for the expanded module, so the extra level costs
 * nothing at rest.
 *
 * ## What it does not decide
 *
 * Every padlock and every check comes from `gate` and `progress.status`, both
 * produced by the server. `itemIcon` chooses a glyph for a pair it is given; it
 * never derives one from the other, and a locked item is locked whatever
 * progress says (CLAUDE.md §4 invariant 1).
 *
 * A locked content is rendered as a disabled button rather than omitted. A
 * learner who cannot see that Modul 4 exists cannot tell a course they have not
 * unlocked from a course that is shorter than they thought.
 */

import { useEffect, useState } from "react";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { moduleHeading } from "../module-title.js";
import { indexTitles, itemIcon, locateContent } from "../player.js";
import type { PlayerAction } from "../player-status.js";
import { Button, StateIcon } from "./primitives.js";

export function ModuleSidebar(props: {
  course: CourseDetail;
  state: EnrolmentState;
  currentContentId: string;
  onOpen: (contentId: string) => void;
  /**
   * The controls the layout draws under this list, in order.
   *
   * A list rather than one (P95-02): the complete design shows **both** an
   * orange *Lernerfolgskontrolle beginnen* and an outlined *Fortbildung
   * pausieren* once the exam opens, and P94-02 swapped one for the other. They
   * are different actions — start the exam, and stop for today — and a learner
   * who wants the second should not have to give up the first to find it.
   *
   * Supplied by the screen inside `CourseShell` rather than decided here: the
   * pause belongs to the media element's own playing state, and the exam gate
   * is the server's. Empty on every screen that has neither, which is what the
   * layout draws for the exam pages.
   */
  actions: readonly PlayerAction[];
  /**
   * The course's Lernerfolgskontrollen, as the layout draws them: rows under
   * the module list rather than a tab beside the video (P95-01).
   */
}) {
  const titles = indexTitles(props.course);
  const here = locateContent(props.course, props.currentContentId);

  // The module being watched opens itself. Held as state rather than derived so
  // the learner can collapse it and browse elsewhere, and re-derived when they
  // move to a different module — otherwise clicking into Modul 4 would leave
  // the sidebar showing Modul 3.
  const [expanded, setExpanded] = useState<string | undefined>(here?.moduleId);
  useEffect(() => setExpanded(here?.moduleId), [here?.moduleId]);

  return (
    /*
      `min-w-0` because this is a grid item, and a grid item's default
      `min-width: auto` is its *min-content* width — here about 361 px, set by
      the longest module title plus its counter and chevron.

      The player's grid has a single column below `lg`, so that min-content
      became the whole track: at the 360 px floor the track was 361 px, the
      video column was dragged out with it, and the host page scrolled
      sideways on the one screen a learner spends half an hour on. The video
      column already had `min-w-0`; this one did not, and one is enough to do
      it.
    */
    <nav aria-label={de.player.outline} className="min-w-0 space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">{de.player.outline}</h2>

      {/*
        Rows separated by a rule, not boxed (P94-02).

        `Player-Ansicht-*` draws one panel with hairlines between the modules;
        ours drew five bordered cards, which reads as five separate things
        rather than one outline of one course. `first:border-t-0` so the list
        does not open with a rule against the heading.
      */}
      <ol className="overflow-hidden rounded-[var(--ds-radius)] border border-gray-200">
        {props.state.modules.map((module, index) => {
          const title = titles.modules.get(module.id) ?? "";
          const open = expanded === module.id;
          /*
            A module you are inside is *under way*, not *being watched*
            (P94-02). The layout gives it the pause glyph and gives the play
            arrow to the chapter, which is the honest split: one is a container
            you are part-way through, the other is the thing in front of you.
          */
          const drawn = itemIcon({
            gate: module.gate,
            progress: module.progress,
            current: here?.moduleId === module.id,
          });
          const state = drawn === "playing" ? "inProgress" : drawn;

          return (
            <li key={module.id} className="border-t border-gray-200 first:border-t-0">
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={de.player.toggleModuleProgress(
                    title,
                    module.progress.completedCount,
                    module.progress.totalCount,
                  )}
                  onClick={() => setExpanded(open ? undefined : module.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-brand-50"
                >
                  <StateIcon state={state} label={de.player.state[state]} tone="module" />
                  <span className="min-w-0 flex-1 truncate">
                    {moduleHeading(index + 1, title)}
                  </span>
                  {/*
                    No "2/3" counter (P93-03). `Player-Ansicht-*` draws the
                    module rows with a glyph, a title and a chevron and nothing
                    else, and the count it replaced is not lost: the glyph says
                    which of the four states the module is in, and expanding it
                    lists every chapter and content with a glyph of its own.

                    It stays in the toggle's accessible name, because there the
                    glyph is announced one row at a time and the count is the
                    only way to hear how much of a module is left without
                    opening it.
                  */}
                  <Chevron open={open} />
                </button>
              </h3>

              {!open ? null : (
                <ul className="space-y-2 border-t border-gray-100 px-3 py-2">
                  {module.chapters.map((chapter) => {
                    const chapterState = itemIcon({
                      gate: chapter.gate,
                      progress: chapter.progress,
                      current: here?.chapterId === chapter.id,
                    });

                    return (
                      <li key={chapter.id}>
                        <p className="flex items-center gap-2 text-xs font-medium text-gray-700">
                          <StateIcon
                            state={chapterState}
                            label={de.player.state[chapterState]}
                            tone="item"
                          />
                          <span className="min-w-0 flex-1">
                            {titles.chapters.get(chapter.id) ?? ""}
                          </span>
                        </p>

                        <ul className="mt-1 space-y-0.5 pl-6">
                          {chapter.contents.map((content) => {
                            const meta = titles.contents.get(content.id);
                            if (meta === undefined) return null;
                            /*
                              The Lernerfolgskontrolle sits in its chapter
                              (P103-02).
                              
                              P95-01 pulled it out into its own list under the
                              modules, following the layout — which draws a
                              course with one exam at the end. A course with an
                              exam *per module* is a different shape: the exam
                              belongs to the content it examines, and separating
                              them put a physician's next step in a different
                              part of the screen from the chapter they had just
                              finished.
                              
                              It is drawn once, here. `ExamRows` is gone rather
                              than kept alongside — two controls for one exam is
                              the defect P94-02 removed from under the video, and
                              it does not become acceptable by being in a
                              sidebar.
                            */
                            const isExam = meta.kind === "quiz";
                            const current = content.id === props.currentContentId;
                            const contentState = itemIcon({
                              gate: content.gate,
                              progress: content.progress,
                              current,
                            });

                            return (
                              <li key={content.id}>
                                <button
                                  type="button"
                                  disabled={content.gate === "locked"}
                                  aria-current={current ? "true" : undefined}
                                  onClick={() => props.onOpen(content.id)}
                                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-brand-50 disabled:cursor-not-allowed disabled:hover:bg-transparent ${
                                    current
                                      ? "bg-brand-50 font-semibold text-brand-700"
                                      : content.gate === "locked"
                                        ? "text-gray-400"
                                        : "text-gray-800"
                                  }`}
                                >
                                  <StateIcon
                                    state={contentState}
                                    label={de.player.state[contentState]}
                                    tone="item"
                                    {...(isExam ? { kind: "exam" as const } : {})}
                                  />
                                  <span
                                    className={`min-w-0 flex-1 ${isExam ? "font-medium" : ""}`}
                                  >
                                    {meta.title}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {/*
        The layout's primary action, under the list (P93-03).

        It was under the video, beside "Zurück zur Übersicht". Both places are
        defensible in the abstract and the drawing picks this one — and having
        looked at it, so would I: under the module list it is the last thing in
        the column that describes the course's state, rather than one of three
        buttons in a row where the destructive-looking one and the leaving one
        are the same size.
      */}
      {props.actions.length === 0 ? null : (
        <div className="space-y-2 pt-2 [&>button]:w-full">
          {props.actions.map((action) => (
            <Button
              key={action.label}
              variant={action.variant}
              disabled={action.disabled}
              onClick={action.run}
            >
              {action.icon === "pause" ? <PauseGlyph /> : null}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </nav>
  );
}

/** The pause bars the layout puts inside **Fortbildung pausieren**. */
function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM7 11H5.5V5H7v6Zm3.5 0H9V5h1.5v6Z" />
    </svg>
  );
}

/** Decorative — `aria-expanded` on the button is what conveys the state. */
function Chevron(props: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
        props.open ? "rotate-180" : ""
      }`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 11 3 6h10l-5 5Z" />
    </svg>
  );
}
