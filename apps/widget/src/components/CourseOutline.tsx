/**
 * The Zertifizierung tab's module tree.
 *
 * Every lock icon on this screen is drawn from `gate`, which the API decided.
 * The component has no rule of its own about what unlocks what — it renders a
 * server verdict. `blockedBy` lets it say *which* chapter is in the way rather
 * than only "locked", which is the difference between a learner who knows what
 * to do next and one who files a support ticket.
 */

import type { CourseDetail, EnrolmentState, ModuleState, ChapterState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { GateBadge } from "./primitives.js";

interface ContentMeta {
  readonly title: string;
  readonly kind: "video" | "text" | "quiz" | "details" | "material";
}

export function CourseOutline(props: {
  course: CourseDetail;
  state: EnrolmentState;
  onOpen: (contentId: string) => void;
}) {
  // The catalog carries titles and kinds; the enrolment carries gates and
  // progress. Neither duplicates the other, so the two are zipped by id here.
  const meta = new Map<string, ContentMeta>();
  const chapterTitles = new Map<string, string>();
  const moduleTitles = new Map<string, string>();

  for (const module of props.course.modules) {
    moduleTitles.set(module.id, module.title);
    for (const chapter of module.chapters) {
      chapterTitles.set(chapter.id, chapter.title);
      for (const content of chapter.contents) {
        meta.set(content.id, { title: content.title, kind: content.kind });
      }
    }
  }

  return (
    <ol className="space-y-4">
      {props.state.modules.map((module, index) => (
        <ModuleRow
          key={module.id}
          module={module}
          ordinal={index + 1}
          title={moduleTitles.get(module.id) ?? ""}
          chapterTitles={chapterTitles}
          meta={meta}
          onOpen={props.onOpen}
        />
      ))}
    </ol>
  );
}

function ModuleRow(props: {
  module: ModuleState;
  ordinal: number;
  title: string;
  chapterTitles: Map<string, string>;
  meta: Map<string, ContentMeta>;
  onOpen: (contentId: string) => void;
}) {
  return (
    <li className="overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {props.ordinal}. {props.title}
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">
            {props.module.progress.completedCount}/{props.module.progress.totalCount}
          </span>
          <GateBadge gate={props.module.gate} labels={de.gate} />
        </div>
      </div>

      <ul className="divide-y divide-gray-100">
        {props.module.chapters.map((chapter) => (
          <ChapterRow
            key={chapter.id}
            chapter={chapter}
            title={props.chapterTitles.get(chapter.id) ?? ""}
            chapterTitles={props.chapterTitles}
            meta={props.meta}
            onOpen={props.onOpen}
          />
        ))}
      </ul>
    </li>
  );
}

function ChapterRow(props: {
  chapter: ChapterState;
  title: string;
  chapterTitles: Map<string, string>;
  meta: Map<string, ContentMeta>;
  onOpen: (contentId: string) => void;
}) {
  const blocker =
    props.chapter.blockedBy === undefined
      ? undefined
      : props.chapterTitles.get(props.chapter.blockedBy);

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm text-gray-800">{props.title}</h4>
        <GateBadge gate={props.chapter.gate} labels={de.gate} />
      </div>

      {props.chapter.gate === "locked" ? (
        <p className="mt-1 text-xs text-gray-500">
          {blocker === undefined
            ? de.gate.lockedHint
            : `${de.gate.lockedHint} („${blocker}“)`}
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {props.chapter.contents.map((content) => {
            const info = props.meta.get(content.id);
            if (info === undefined) return null;

            const reachable = content.gate !== "locked";
            return (
              <li key={content.id}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => props.onOpen(content.id)}
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-brand-50 disabled:hover:bg-transparent"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-gray-400">
                      {de.content[info.kind]}
                    </span>
                    <span className={reachable ? "text-gray-800" : "text-gray-400"}>
                      {info.title}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {info.kind === "video" &&
                    content.progress.watchedPercent !== undefined ? (
                      <span className="text-xs text-gray-500">
                        {de.content.watched(content.progress.watchedPercent)}
                      </span>
                    ) : null}
                    <GateBadge gate={content.gate} labels={de.gate} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
