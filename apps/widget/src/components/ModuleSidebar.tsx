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
import { StateIcon } from "./primitives.js";

export function ModuleSidebar(props: {
  course: CourseDetail;
  state: EnrolmentState;
  currentContentId: string;
  onOpen: (contentId: string) => void;
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
    <nav aria-label={de.player.outline} className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-900">{de.player.outline}</h2>

      <ol className="space-y-1">
        {props.state.modules.map((module, index) => {
          const title = titles.modules.get(module.id) ?? "";
          const open = expanded === module.id;
          const state = itemIcon({
            gate: module.gate,
            progress: module.progress,
            current: here?.moduleId === module.id,
          });

          return (
            <li
              key={module.id}
              className="rounded-[var(--ds-radius)] border border-gray-200"
            >
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={de.player.toggleModule(title)}
                  onClick={() => setExpanded(open ? undefined : module.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-900 hover:bg-brand-50"
                >
                  <StateIcon state={state} label={de.player.state[state]} />
                  <span className="min-w-0 flex-1 truncate">
                    {moduleHeading(index + 1, title)}
                  </span>
                  <span className="text-xs tabular-nums text-gray-500">
                    {module.progress.completedCount}/{module.progress.totalCount}
                  </span>
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
                          />
                          <span className="min-w-0 flex-1">
                            {titles.chapters.get(chapter.id) ?? ""}
                          </span>
                        </p>

                        <ul className="mt-1 space-y-0.5 pl-6">
                          {chapter.contents.map((content) => {
                            const meta = titles.contents.get(content.id);
                            if (meta === undefined) return null;

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
                                  />
                                  <span className="min-w-0 flex-1">{meta.title}</span>
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
    </nav>
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
