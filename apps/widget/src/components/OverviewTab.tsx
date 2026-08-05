/**
 * The Übersicht tab (layout §4.2).
 *
 * Description, Lernziele, Zielgruppe and the module list with per-module
 * duration and a chapter-topic subtitle.
 *
 * ## Why the durations are computed here and the percentages are not
 *
 * A module's duration is the sum of its video lengths — arithmetic over data
 * the browse response already carries, with no consequence if it is a second
 * out. A module's *completion* is a compliance verdict and is never computed
 * here: it comes from `EnrolmentState`, which the server produced (CLAUDE.md
 * §4 invariant 1). The distinction is the whole reason this file is allowed to
 * add numbers together at all.
 */

import { useState } from "react";
import type { CourseDetail, EnrolmentState, ModuleSummary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { moduleHeading } from "../module-title.js";
import { CheckBullet, Section } from "./primitives.js";

export function OverviewTab(props: { course: CourseDetail; state: EnrolmentState }) {
  const { course } = props;

  return (
    <div className="space-y-8">
      {course.description === null ? null : (
        <Section title={de.overviewTab.description}>
          <Expandable text={course.description} />
        </Section>
      )}

      {course.learningObjectives.length === 0 ? null : (
        <Section title={de.overviewTab.objectives}>
          <p className="text-sm text-gray-700">{de.overviewTab.objectivesLead}</p>
          <ul className="space-y-3">
            {course.learningObjectives.map((objective) => (
              <li key={objective} className="flex gap-3 text-sm text-gray-800">
                {/* The tick is decorative — "Lernziele" is the heading and the
                    list semantics carry the rest. */}
                <CheckBullet />
                <span>{objective}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {course.targetAudience === null ? null : (
        <Section title={de.overviewTab.audience}>
          {/* Newlines are the only formatting the field carries, and
              `whitespace-pre-line` is what preserves them without ever
              interpreting the content as markup. */}
          <p className="whitespace-pre-line text-sm text-gray-800">
            {course.targetAudience}
          </p>
        </Section>
      )}

      {/*
        The layout's Inhalte list: an arrow, the module title, its chapter
        topics beneath, and the duration hard right. The row is not a link —
        opening a module from here would bypass the sequential gate, and the
        arrow is the layout's own affordance for "this comes next", not for
        "click me".
      */}
      <Section title={de.overviewTab.contents}>
        <ol className="divide-y divide-gray-200">
          {course.modules.map((module, index) => (
            <li key={module.id} className="flex items-start gap-3 py-4">
              <span aria-hidden="true" className="mt-0.5 text-brand-600">
                →
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900">
                  {moduleHeading(index + 1, module.title)}
                </p>
                {chapterTopics(module) === "" ? null : (
                  <p className="mt-1 text-xs text-gray-600">{chapterTopics(module)}</p>
                )}
              </div>

              <p className="shrink-0 whitespace-nowrap text-sm text-gray-700">
                {de.overviewTab.moduleMeta(
                  moduleDurationSec(module),
                  module.chapters.length,
                )}
              </p>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}

/**
 * Long prose with a _Mehr lesen…_ toggle.
 *
 * Collapsed with CSS rather than by truncating the string: the whole text stays
 * in the DOM, so a screen reader and a page search find all of it whichever
 * state the toggle is in.
 */
function Expandable(props: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="space-y-2">
      <p
        className={`whitespace-pre-line text-sm text-gray-800 ${
          expanded ? "" : "line-clamp-4"
        }`}
      >
        {props.text}
      </p>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="text-sm font-medium text-brand-700 underline"
      >
        {expanded ? de.overviewTab.less : de.overviewTab.more}
      </button>
    </div>
  );
}

function moduleDurationSec(module: ModuleSummary): number {
  return module.chapters
    .flatMap((chapter) => chapter.contents)
    .reduce((total, content) => total + (content.durationSec ?? 0), 0);
}

/**
 * The topic line under a module: "ADHS-Definition · Epidemiologie · Neurobiologie".
 *
 * `modules.subtitle` is the authored value and is what the layout draws — it is
 * the module's *topics*, which are not the same as its chapter titles and are
 * usually more numerous. This ignored it entirely and joined the chapter titles
 * instead, so a course with one long chapter per module (which the MEDICE
 * course is) showed "Kapitel 1 – Definition und Epidemiologie" where the design
 * shows four topics. The value was authored, stored, carried by the API and
 * dropped at the last step.
 *
 * The chapter-title join stays as the fallback, for a course whose author has
 * not written a subtitle: some topic line is better than a blank space, and it
 * is the same shape.
 */
function chapterTopics(module: ModuleSummary): string {
  const subtitle = module.subtitle?.trim() ?? "";
  if (subtitle !== "") return subtitle;
  return module.chapters.map((chapter) => chapter.title).join(" · ");
}
