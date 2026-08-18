import { useState, type ReactNode } from "react";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { indexTitles, locateContent } from "../player.js";
import { PlayerStatusContext, type PlayerStatus } from "../player-status.js";
import { BrandLogo } from "./BrandLogo.js";
import { ModuleSidebar, type ExamRow } from "./ModuleSidebar.js";
import { PlayerProgressCard } from "./PlayerProgressCard.js";
import { StickyProgress } from "./StickyProgress.js";
import { Button } from "./primitives.js";

/**
 * The chrome the layout draws on pages 06 to 13 (#61).
 *
 * A teal region carrying the logo, the course title and the way out, with one
 * white panel pulled up over its lower edge — the screen's content on the left,
 * **Modul Übersicht** on the right.
 *
 * ## Why five screens share it
 *
 * The player, the exam's four states and the Punktemeldung are drawn
 * identically in the layout, down to the sidebar and its ticks. They used to be
 * two different things here: the player had its own masthead and its own
 * sidebar, and the quiz, the evaluation and the completion form rendered inside
 * the *course detail's* tab panel — under a tab row the layout does not draw on
 * any of those pages, and beside no module list at all.
 *
 * Sharing it is not only fidelity. The sidebar states are gate verdicts; a
 * second copy built beside the exam would have been a second reading of which
 * chapter is unlocked, and the two would eventually disagree.
 *
 * ## Deliberately not the course hero
 *
 * These screens show one thing at a time. Repeating the course's points,
 * duration and four tabs above a running video is navigation away from the only
 * thing the learner came here to do.
 *
 * "Zurück zur Übersicht" is orange and sits top-right, which is the one place
 * the layout puts the accent on a *leaving* action — because here leaving is
 * the resume-adjacent action: it is how a learner parks a module and comes back
 * to it.
 *
 * ## Two things the screen owns and this draws (P93-03)
 *
 * The **progress card** goes in the teal band beside the title, and the
 * **primary action** goes under the module list — both as drawn, and both
 * belonging to a screen that renders as this component's `children`. They
 * arrive through `PlayerStatusContext`, whose header explains why that is the
 * cheap direction and a lifted clock is not.
 */
export function CourseShell(props: {
  apiBase: string;
  projectSlug: string;
  course: CourseDetail;
  state: EnrolmentState;
  /**
   * What the sidebar should mark as current. Empty on the exam-result, the
   * evaluation and the Punktemeldung, which are not a content — `locateContent`
   * finds nothing and the sidebar opens no module, which is how the layout
   * draws those pages.
   */
  currentContentId: string;
  onOpen: (contentId: string) => void;
  onBack: () => void;
  onResume: (() => void) | undefined;
  /**
   * Whether the floating progress module is drawn (below `sm` only).
   *
   * False on the exam and on the Punktemeldung. It is `fixed` to the viewport's
   * bottom-right, and measured at 430 px it lands over an **answer option** —
   * where a mis-tap costs a question rather than a scroll position. Its purpose
   * is the resume affordance, and there is nothing to resume mid-exam: the
   * learner is in the one part of the course they cannot leave and come back
   * into halfway.
   */
  progress: boolean;
  children: ReactNode;
}) {
  /*
   * What the screen inside reports about itself (P93-03).
   *
   * Held here rather than passed in, because this is the nearest ancestor of
   * both the places the layout draws it. `setStatus` is `useState`'s own
   * setter, so the context value never changes identity and a report does not
   * re-render the player — see `player-status.tsx`.
   */
  const [status, setStatus] = useState<PlayerStatus | undefined>(undefined);
  const here = locateContent(props.course, props.currentContentId);

  return (
    <div>
      {/*
        Full-bleed, with one large corner where it ends (layout 6.1). `-mx-4`
        cancels the widget's own gutter — the layout runs this teal to the edge
        of the page and rounds only its inner corner, which reads as the page
        *becoming* white rather than as a band sitting on it.
      */}
      <div className="-mx-4 rounded-br-[5rem] bg-brand-600 px-6 pb-20 pt-6 sm:px-8">
        {/*
          `ml-auto` on the button rather than `justify-between` on the row:
          `BrandLogo` renders nothing for a project with no logo configured,
          and with one child `justify-between` left-aligns it — so the back
          action drifted to the top *left* on exactly the deployments that have
          not finished branding yet.
        */}
        <div className="flex flex-wrap items-start gap-4">
          <BrandLogo apiBase={props.apiBase} projectSlug={props.projectSlug} />
          <div className="ml-auto">
            <Button variant="cta" onClick={props.onBack}>
              <span aria-hidden="true">←</span>
              {de.player.back}
            </Button>
          </div>
        </div>

        {/*
          The title and the progress card side by side, as
          `Player-Ansicht-*` draws them: the card is a white panel in the teal,
          right-aligned, and it wraps under the title rather than shrinking on a
          narrow host. `lg:` because below that the widget's column is the
          phone layout, where the card belongs above the video and the sticky
          progress teardrop is the resume affordance.
        */}
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <h1 className="min-w-0 text-2xl font-bold text-brand-contrast sm:text-3xl">
            {props.course.title}
          </h1>
          <div className="w-full lg:w-[26rem]">
            <PlayerProgressCard
              state={props.state}
              moduleIndex={here?.moduleIndex}
              moduleCount={props.course.modules.length}
              status={status}
            />
          </div>
        </div>
      </div>

      {/*
        Pulled up over the teal, the same device the course meta strip uses.

        `max-sm:pb-24` is for the floating progress module. It is `fixed` to the
        viewport's bottom-right below `sm`, so at 320 px it sits over whatever
        happens to be there — and measured at that width, that is the video's
        lower-right corner. The player's controls are below the video rather
        than overlaid on it, so they are not what it covers; the padding is what
        guarantees the last of them can always be scrolled clear of it, at every
        scroll position rather than at most of them.
      */}
      <div className="-mt-14 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm max-sm:pb-24 sm:p-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4">
            <PlayerStatusContext.Provider value={setStatus}>
              {props.children}
            </PlayerStatusContext.Provider>
          </div>

          <ModuleSidebar
            course={props.course}
            state={props.state}
            currentContentId={props.currentContentId}
            onOpen={props.onOpen}
            actions={status?.actions ?? []}
            exams={examRows(props.course, props.state)}
          />
        </div>
      </div>

      {/*
        The floating resume module below `sm` (P19-01). Its own comment always
        said its whole reason for existing was "being the resume affordance
        *while a video is playing*" — and it was rendered only inside the course
        detail's tab panel, which the player returns before reaching. It was
        absent from the one screen it was built for.
      */}
      {props.progress ? (
        <StickyProgress state={props.state} onResume={props.onResume} />
      ) : null}
    </div>
  );
}

/**
 * The Lernerfolgskontrollen, as rows under the module list (P95-01).
 *
 * ## Why this is derived here and not decided by the sidebar
 *
 * The sidebar renders what it is given; which exams a course has and whether
 * each is open is a reading of the catalogue tree against the server's gates,
 * and that reading already exists twice too often. `indexTitles` is the one
 * place titles and kinds are zipped onto the enrolment's gates, so it is used
 * here too rather than a fourth walk of the tree.
 *
 * ## The label
 *
 * The layout draws one row, labelled simply **Lernerfolgskontrolle**. Since
 * P87 a course may have one per module, so a course with several names them —
 * a physician looking at three identical rows cannot tell which is which, and
 * that is the defect P87-05 found on the exam screen itself. One exam keeps the
 * layout's word.
 *
 * ## Locked
 *
 * Straight from `gate`, which is the server's (§4 invariant 1). The widget
 * nowhere decides that finishing a module opens its exam; it draws the answer.
 */
function examRows(course: CourseDetail, state: EnrolmentState): readonly ExamRow[] {
  const titles = indexTitles(course);
  const rows: ExamRow[] = [];

  state.modules.forEach((module, index) => {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        const meta = titles.contents.get(content.id);
        if (meta?.kind !== "quiz") continue;
        rows.push({
          id: content.id,
          title: meta.title,
          moduleOrdinal: index + 1,
          locked: content.gate === "locked",
        });
      }
    }
  });

  // One exam keeps the layout's word. Several are told apart by their module,
  // because an author naming all of them "Lernerfolgskontrolle" is the obvious
  // thing to type and no amount of authoring discipline fixes that from here.
  return rows.length === 1 && rows[0] !== undefined
    ? [{ ...rows[0], title: de.player.tabs.quiz }]
    : rows.map((row) => ({
        ...row,
        title: de.player.examInModule(row.title, row.moduleOrdinal),
      }));
}
