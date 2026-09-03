import { useState, type ReactNode } from "react";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { locateContent } from "../player.js";
import { PlayerStatusContext, type PlayerStatus } from "../player-status.js";
import { BrandLogo } from "./BrandLogo.js";
import { ModuleSidebar } from "./ModuleSidebar.js";
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
          right-aligned, with the title shrinking beside it. `lg:` because below
          that the widget's column is the phone layout, where the card belongs
          above the video and the sticky progress teardrop is the resume
          affordance.

          ## The card's width, and the row it sits in (DEP-24)

          `player-zusammenfassung-v1.png` is drawn **1:1 for 1920×1080**, which
          is worth stating because an earlier reading of it here was wrong. The
          artwork's `0% absolviert` measures 95×12 px of ink and Inter 14 px
          semibold renders it at 94×12 — the drawing's own type, at the sizes
          this file already uses. So its card is **576 px = 36rem**, not the
          432 px a scaled reading suggested, and the previous `26rem` was
          simply 160 px narrower than the drawing.

          That is the whole of the client's report. The footer needs 505 px in
          Inter (221 label + 16 gap + 268 note); `26rem` gave it 384 and the
          note went to a second line. At the drawn 36rem it has 544 and fits,
          with the S16 wording, with 39 px to spare.

          ## Why the row is three widths and not one

          A drawing is one viewport. Three things change under it:

          - **The title.** `Titel der Fortbildung` is 413 px; the MEDICE course
            is `Basisseminar 2026 – Diagnostik und Therapie bei Erwachsenen`,
            928 px at `sm:text-3xl`. With `basis-auto` the row could not hold
            both at their natural widths at *any* width this platform is served
            at, so it wrapped and the card landed under the title, left-aligned
            — the arrangement the drawing does not have, on every screen. The
            title now takes `basis-full` below `lg` and `lg:basis-[18rem]`
            above it: it shrinks and wraps so the card can keep its size, and
            the row still breaks if a host's column is narrower than
            18rem + gap + card.
          - **The host's column.** This is WordPress's, not ours: `max-w-full`
            and the `basis` above are what keep a 36rem card from overflowing a
            column that never agreed to it.
          - **The viewport.** `xl:w-[36rem]` is the drawing — `max-w-xl`'s own
            value — from 1280 up. At `lg` (1024) it would leave the title
            312 px, so the card steps down to `lg:w-[32rem]`, which is
            `max-w-lg`. That is 478 px of content against the 505 the footer
            wants, so between 1024 and 1280 the two halves keep their row and
            wrap inside it; §9.4's question — *what does the person do next* —
            is answered either way, and a title squeezed to four lines is not.

          Below `lg` the card is full width under the title, which is what
          `player-ansicht-abgeschlossen.png` draws for the phone.

          Measured with the real Inter faces at the shipped sizes, at 320, 360,
          390, 414, 540, 640, 768, 834, 900, 1024, 1280, 1440, 1600 and 1920 —
          no horizontal overflow at any of them. The numbers are in
          `docs/backlog/P158.md`.
        */}
        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <h1 className="min-w-0 grow basis-full text-2xl font-bold text-brand-contrast sm:text-3xl lg:basis-[18rem]">
            {props.course.title}
          </h1>
          <div className="w-full max-w-full lg:w-[32rem] xl:w-[36rem]">
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
        {/*
          The sidebar is `20rem`, the drawing's is 304 px (DEP-24).

          Scanned off `player-zusammenfassung-v1.png`, which is 1:1 for 1920:
          the module rows run x 1322…1625, so 304 px — exactly between
          Tailwind's `w-72` (288) and `w-80` (320), and rounded up to the step
          rather than left on a number from a ruler. It used to be `18rem`.

          The video is not a width anybody sets; it is what is left of this row:

              video = panel − border − 2 × sm:p-6 − gap-6 − sidebar

          so it is right only when the column is. At the portal's
          `max-w-screen-2xl` that is 1062 px against the drawing's 1022 — the
          same 73 % of the panel, four per cent larger, which is what taking
          every term from Tailwind's scale costs. `apps/portal/src/App.tsx`
          carries the arithmetic. Inside a customer's WordPress column it is
          whatever that theme allows, and the grid degrades to one column below
          `lg` regardless.
        */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
