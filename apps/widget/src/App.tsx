/**
 * The widget's root (P5).
 *
 * ## Two entry points, one screen graph
 *
 * With a `course` attribute the widget opens that Fortbildung directly — how
 * MEDICE embeds it on a page dedicated to one course. Without one it opens the
 * catalogue (layout §4.1) and the learner picks. Everything after the pick is
 * identical, so there is one course screen rather than two.
 *
 * ## One rule governs the whole screen graph
 *
 * `EnrolmentState` is the only thing that says what is unlocked, what is
 * outstanding and whether the course is done — and it comes from the server.
 * Every mutation ends with `reload()`, never with a local edit to that object.
 * A locally-patched "the quiz is passed now" would be a client-side gate, which
 * is exactly what CLAUDE.md §4 forbids: the client renders a verdict, it does
 * not reach one.
 *
 * ## Navigation
 *
 * Deliberately component state rather than a router. The widget lives inside a
 * WordPress page whose URL belongs to the host; pushing history entries would
 * fight the theme's own navigation and break the browser Back button in ways a
 * learner would experience as the page vanishing.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { createWidgetClient, isConfigured, type WidgetConfig } from "./api.js";
import { useBranding } from "./branding.js";
import { de } from "./locale/de.js";
import { describeError, useAsync, useEnrolment } from "./hooks.js";
import type { TokenProvider } from "./token.js";
import { CourseList } from "./components/CourseList.js";
import { CertificationTab } from "./components/CertificationTab.js";
import { ProgressCard, StickyMetaBar } from "./components/CourseHeader.js";
import { StickyProgress } from "./components/StickyProgress.js";
import { ExpertsTab } from "./components/ExpertsTab.js";
import { OverviewTab } from "./components/OverviewTab.js";
import { ModuleSidebar } from "./components/ModuleSidebar.js";
import { PlayerScreen } from "./components/PlayerScreen.js";
import { QuizScreen } from "./components/QuizScreen.js";
import { EvaluationScreen } from "./components/EvaluationScreen.js";
import { CompletionScreen } from "./components/CompletionScreen.js";
import { CertificatePanel } from "./components/CertificatePanel.js";
import { MediathekPanel } from "./components/MediathekPanel.js";
import { Button, ErrorNotice, Spinner, TabbedPanel } from "./components/primitives.js";

/** The four tabs of the course detail (layout §4.2). */
const TABS = ["overview", "speakers", "certification", "library"] as const;
type Tab = (typeof TABS)[number];

type Screen =
  | { kind: "outline" }
  | { kind: "lesson"; contentId: string }
  | { kind: "quiz"; contentId: string }
  /**
   * `then` is where submitting lands, and it exists because the evaluation is
   * reached from two places that mean different things by it. From the
   * Zertifizierung tab it is a thing the learner chose to do and they go back
   * where they were; from the quiz-passed screen's **CME-Punkte geltend
   * machen** it is a step on the way to the Punktemeldung, and stopping there
   * would leave a physician who just passed staring at the tab they started on.
   */
  | { kind: "evaluation"; then: "outline" | "reporting" }
  /** The Punktemeldung — layout page 13. Its own screen since #60. */
  | { kind: "reporting" };

/**
 * What the learner asked for when they picked a course.
 *
 * The catalogue offers two buttons and the layout means two different things by
 * them: **Zur Fortbildung** is *browse* — the course's own start page, with its
 * description, its Referenten and its Zertifizierung — and **Fortbildung
 * fortsetzen** is *carry on*, straight back into the video they were watching.
 * Sending both to the same screen would make the second button decorative.
 */
type OpenIntent = "start" | "resume";

/**
 * The screen a piece of content opens on.
 *
 * Module-level so the outline's click and the catalogue's resume cannot drift:
 * a quiz that opened as a lesson would render a player with no video in it.
 */
function screenFor(course: CourseDetail, contentId: string): Screen | undefined {
  for (const module of course.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        if (content.id !== contentId) continue;
        return content.kind === "quiz"
          ? { kind: "quiz", contentId }
          : { kind: "lesson", contentId };
      }
    }
  }
  return undefined;
}

export interface AppProps extends WidgetConfig {
  readonly getToken: TokenProvider | undefined;
  /**
   * Announce a catalogue pick to the host page. Returns `false` when the host
   * has taken over navigation, in which case this widget stays put — see
   * `element.ts`. Absent in tests and in any host that does not route.
   */
  readonly onCourseOpen?:
    ((slug: string, intent: "start" | "resume") => boolean) | undefined;
  /**
   * Where a course named by the `course` attribute opens.
   *
   * `"resume"` lands in the content the learner left off at, which is how a
   * routing host carries the catalogue's **Fortbildung fortsetzen** across its
   * own navigation. Defaults to the course's start page.
   */
  readonly openAt?: "start" | "resume" | undefined;
  /** Fired whenever the server returns a fresh `EnrolmentState`. */
  readonly onProgress?: ((detail: ProgressDetail) => void) | undefined;
  /** Fired once, the first time the server reports the course complete. */
  readonly onCourseComplete?: ((detail: CourseCompleteDetail) => void) | undefined;
}

/**
 * What a host page is told about progress.
 *
 * Deliberately every figure at once rather than a percentage: a host wiring
 * this to analytics needs to know *which* percentage, and the platform has
 * three legitimate ones — union watch coverage, content-item completion, and
 * modules finished. Naming them individually is what stops a host reporting one
 * and labelling it another, which is the same mistake S16 records on our own
 * screen.
 */
export interface ProgressDetail {
  readonly courseSlug: string;
  readonly watchedPercent: number;
  readonly requiredWatchPercent: number;
  readonly coursePercent: number;
  readonly modulesCompleted: number;
  readonly modulesTotal: number;
  readonly outstanding: readonly string[];
  readonly complete: boolean;
}

export interface CourseCompleteDetail {
  readonly courseSlug: string;
  readonly completedAt: string;
}

export function App(props: AppProps) {
  // A missing api-base or project is a page-integration mistake, not a learner
  // problem, so it gets its own message rather than a wall of failed requests.
  if (!isConfigured(props) || props.getToken === undefined) {
    return <ErrorNotice title={de.error.title} message={de.error.misconfigured} />;
  }
  return <Routed {...props} getToken={props.getToken} />;
}

/**
 * Catalogue or course.
 *
 * The client is built once here, from the project binding alone, and passed
 * down — the course slug is a screen's argument, not the client's
 * configuration, so moving between courses does not rebuild it and lose the
 * token cache with it.
 */
function Routed(
  props: WidgetConfig & {
    getToken: TokenProvider;
    onCourseOpen?: ((slug: string, intent: OpenIntent) => boolean) | undefined;
    openAt?: OpenIntent | undefined;
    onProgress?: ((detail: ProgressDetail) => void) | undefined;
    onCourseComplete?: ((detail: CourseCompleteDetail) => void) | undefined;
  },
) {
  const { apiBase, projectSlug, courseSlug, getToken, onCourseOpen } = props;

  const client = useMemo(
    () => createWidgetClient({ apiBase, projectSlug, courseSlug }, getToken),
    [apiBase, projectSlug, courseSlug, getToken],
  );

  // The attribute wins for the whole lifetime of the element: a page that
  // names a course is showing that course, and there is no back link to a
  // catalogue the host page never asked for.
  const [selected, setSelected] = useState<string | undefined>(
    courseSlug === "" ? undefined : courseSlug,
  );
  // A course named by the host attribute is being *browsed* unless the host
  // says otherwise: the page it sits on is the entry point, and dropping
  // straight into a video would take the learner past whatever that page had to
  // say. `open-at="resume"` is a routing host carrying the catalogue's
  // **Fortbildung fortsetzen** across its own navigation.
  const [intent, setIntent] = useState<OpenIntent>(props.openAt ?? "start");

  if (selected === undefined) {
    return (
      <Catalogue
        apiBase={apiBase}
        projectSlug={projectSlug}
        client={client}
        onOpen={(slug, chosen) => {
          // A host that routes cancels the event and replaces this element
          // with one pinned to the course. Switching screens here as well
          // would render the course twice, briefly.
          if (onCourseOpen !== undefined && !onCourseOpen(slug, chosen)) return;
          setIntent(chosen);
          setSelected(slug);
        }}
      />
    );
  }

  return (
    <Loaded
      apiBase={apiBase}
      projectSlug={projectSlug}
      courseSlug={selected}
      client={client}
      openAt={intent}
      // Only offered when the learner arrived through the catalogue.
      onBackToCatalogue={courseSlug === "" ? () => setSelected(undefined) : undefined}
      onProgress={props.onProgress}
      onCourseComplete={props.onCourseComplete}
    />
  );
}

/**
 * The catalogue screen.
 *
 * Its own component only so `useBranding` has somewhere to be called from —
 * `Routed` returns early for the course case, and a hook cannot live behind
 * that.
 */
function Catalogue(props: {
  apiBase: string;
  projectSlug: string;
  client: ReturnType<typeof createWidgetClient>;
  onOpen: (slug: string, intent: OpenIntent) => void;
}) {
  const branding = useBranding(props.apiBase, props.projectSlug);

  return (
    <div className="space-y-6">
      {/*
        The wrapper only when there is something in it.
        `BrandLogo` returns null when the customer has set no logo, but
        `px-4 pt-4` inside a `space-y-6` does not — it left 40 px of nothing
        above the hero, which the layout draws flush to the host page's header.
        Visible the moment the catalogue was screenshotted at 430 px against
        the mobile design, and just as wrong at 1440 px.
      */}
      {branding.logoUrl === undefined ? null : (
        <div className="px-4 pt-4">
          <BrandLogo apiBase={props.apiBase} projectSlug={props.projectSlug} />
        </div>
      )}
      <CourseList client={props.client} branding={branding} onOpen={props.onOpen} />
    </div>
  );
}

function Loaded(props: {
  apiBase: string;
  projectSlug: string;
  courseSlug: string;
  client: ReturnType<typeof createWidgetClient>;
  /** `"resume"` opens the player at the resume point instead of the overview. */
  openAt: OpenIntent;
  onBackToCatalogue: (() => void) | undefined;
  onProgress: ((detail: ProgressDetail) => void) | undefined;
  onCourseComplete: ((detail: CourseCompleteDetail) => void) | undefined;
}) {
  const { apiBase, projectSlug, courseSlug, client } = props;

  // De-duplicated with the logo's fetch and the catalogue's — see branding.ts.
  const branding = useBranding(apiBase, projectSlug);

  const [tab, setTab] = useState<Tab>("overview");
  const [screen, setScreen] = useState<Screen>({ kind: "outline" });

  const course = useAsync(() => client.getCourseBySlug(courseSlug), [client, courseSlug]);
  const enrolment = useEnrolment(client, courseSlug);

  useAnnouncements(courseSlug, enrolment.data, props.onProgress, props.onCourseComplete);

  /*
   * "Fortbildung fortsetzen", carried through from the catalogue.
   *
   * From an effect rather than an initial `useState` value, because where to
   * resume is part of the enrolment state and that has not arrived on the first
   * render. From the *server's* `resumeContentId` rather than anything worked
   * out here: which chapter comes next after a finished one is a rule about a
   * course that awards a CME point, and the client renders such verdicts rather
   * than reaching them.
   *
   * Once only. Coming back to the outline from the player is a decision the
   * learner made, and re-applying the intent would trap them in the video.
   */
  const resumed = useRef(false);
  useEffect(() => {
    if (props.openAt !== "resume" || resumed.current) return;
    const target = enrolment.data?.resumeContentId;
    const detail = course.data;
    if (target === undefined || target === null || detail === undefined) return;
    resumed.current = true;
    const next = screenFor(detail, target);
    if (next !== undefined) setScreen(next);
  }, [props.openAt, enrolment.data, course.data]);

  if (course.loading || enrolment.loading) {
    return <Spinner label={de.loading} />;
  }

  const failure = course.error ?? enrolment.error;
  if (
    failure !== undefined ||
    course.data === undefined ||
    enrolment.data === undefined
  ) {
    return (
      <ErrorNotice
        title={de.error.title}
        message={describeError(failure, de.error)}
        retryLabel={de.error.retry}
        onRetry={() => {
          course.reload();
          enrolment.reload();
        }}
      />
    );
  }

  const state = enrolment.data;
  const detail = course.data;

  function open(contentId: string): void {
    const next = screenFor(detail, contentId);
    if (next !== undefined) setScreen(next);
  }

  const back = () => setScreen({ kind: "outline" });
  const refresh = () => enrolment.reload();

  /*
   * Where **Fortbildung fortsetzen** goes.
   *
   * `resumeContentId` is the first *incomplete* reachable content, so it is
   * null once the learner has finished everything — and since #60 removed the
   * module outline from the Zertifizierung tab, that null was the last way back
   * into the course. A physician who completed a course could no longer look at
   * any of it again.
   *
   * So a finished course falls back to its first content. The server still
   * decides where an unfinished one resumes; this only decides what "continue"
   * means when there is nothing outstanding, which is a navigation question and
   * not a compliance one.
   */
  const firstContentId = detail.modules[0]?.chapters[0]?.contents[0]?.id;
  const resumeId = state.resumeContentId ?? firstContentId;
  const resume = resumeId === undefined ? undefined : () => open(resumeId);

  /*
   * The player is its own screen, not a fifth tab (layout §4.3).
   *
   * The layout draws it that way and the reason holds up: watching a module is
   * the only thing on this platform that takes half an hour of a physician's
   * attention, and the course chrome — hero, meta strip, four tabs — is
   * navigation *away* from it. Keeping that chrome above a running video puts
   * three competing progress readings on one screen (the meta bar's, the
   * progress card's, the player's own) and pushes the video below the fold on
   * a laptop.
   *
   * It renders before the course layout rather than inside it, so none of that
   * chrome is constructed at all.
   */
  if (screen.kind !== "outline") {
    const shell = (body: React.ReactNode, currentContentId: string) => (
      <div className="p-4">
        <CourseShell
          apiBase={apiBase}
          projectSlug={projectSlug}
          course={detail}
          state={state}
          currentContentId={currentContentId}
          onOpen={(contentId) => {
            refresh();
            open(contentId);
          }}
          onBack={() => {
            refresh();
            back();
          }}
          onResume={resume}
        >
          {body}
        </CourseShell>
      </div>
    );

    if (screen.kind === "lesson") {
      return shell(
        <Player
          client={client}
          courseSlug={courseSlug}
          course={detail}
          state={state}
          contentId={screen.contentId}
          onProgress={refresh}
          onOpen={(contentId) => {
            refresh();
            open(contentId);
          }}
          onBack={() => {
            refresh();
            back();
          }}
          onReporting={() => {
            refresh();
            setScreen({ kind: "reporting" });
          }}
        />,
        screen.contentId,
      );
    }

    if (screen.kind === "quiz") {
      return shell(
        <QuizGate
          client={client}
          courseSlug={courseSlug}
          contentId={screen.contentId}
          onPassed={refresh}
          onBack={() => {
            refresh();
            back();
          }}
          /*
           * **CME-Punkte geltend machen** (layout 12.3).
           *
           * The evaluation first when it is still outstanding, and that order
           * is the server's rule rather than a preference: the API refuses a
           * completion whose evaluation is missing, so sending the learner
           * straight to page 13 would end in a rejection *after* they had typed
           * their EFN.
           */
          onClaimPoints={() => {
            refresh();
            setScreen(
              state.evaluationSubmitted
                ? { kind: "reporting" }
                : { kind: "evaluation", then: "reporting" },
            );
          }}
        />,
        screen.contentId,
      );
    }

    if (screen.kind === "evaluation") {
      const then = screen.then;
      return shell(
        <EvaluationGate
          client={client}
          courseSlug={courseSlug}
          onSubmitted={() => {
            refresh();
            if (then === "reporting") setScreen({ kind: "reporting" });
            else back();
          }}
          onBack={back}
        />,
        "",
      );
    }

    return shell(
      <CompletionScreen
        client={client}
        courseSlug={courseSlug}
        state={state}
        branding={branding}
        onCompleted={() => {
          refresh();
          // Back to the tab that describes the certificate, which is now where
          // the download is.
          setTab("certification");
          back();
        }}
      />,
      "",
    );
  }

  return (
    <div className="space-y-6 p-4">
      <BrandLogo apiBase={apiBase} projectSlug={projectSlug} />

      <StickyMetaBar
        course={detail}
        state={state}
        onBack={props.onBackToCatalogue}
        onResume={resume}
      />

      {/*
        Two columns, as the layout has them: the tab panel, and the progress
        card that repeats beside all four tabs (§4.2).

        The card is deliberately absent over the player, the quiz and the
        evaluation — each of those has a progress reading of its own, and two
        different accounts of the same course on one screen is one too many.
      */}
      <TabbedPanel
        tabs={TABS.map((entry) => ({ id: entry, label: de.tabs[entry] }))}
        active={tab}
        label={detail.title}
        onSelect={(entry) => {
          setTab(entry);
          back();
        }}
      >
        {/*
          Only the outline reaches here now: the player, the exam and the
          Punktemeldung render through `CourseShell` above, which is what the
          layout draws for them — a teal masthead and the Modul Übersicht, with
          no tab row (#61).
        */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          {/* `max-sm:` drops the top border and the top rounding: below `sm` the
            heading `TabbedPanel` renders supplies both, and two borders meeting
            draw a 2 px rule across what the layout has as one line. */}
          <div className="min-w-0 rounded-2xl rounded-tl-none border border-gray-100 bg-white p-5 shadow-sm max-sm:rounded-t-none max-sm:border-t-0 max-sm:border-brand-500 sm:p-6">
            {tab === "overview" ? (
              <OverviewTab course={detail} state={state} />
            ) : tab === "speakers" ? (
              <ExpertsTab experts={detail.experts} />
            ) : tab === "library" ? (
              <Mediathek
                client={client}
                courseSlug={courseSlug}
                key={state.progress.percent}
              />
            ) : (
              /*
               * The Zertifizierung tab, informational (layout page 04).
               *
               * It used to be the module outline plus the EFN form plus
               * **Fortbildung abschließen**. The layout has none of that here
               * and #60 moved it: the form is the `reporting` screen above,
               * reached from the quiz-passed screen, and the outline is gone —
               * the player's Modul Übersicht is the course's navigation, and a
               * second one on the detail page was a way past the sequential
               * gate that the layout deliberately does not offer.
               */
              <CertificationTab
                course={detail}
                certificate={
                  state.completedAt === null ? (
                    <p className="mt-6 text-sm text-gray-500">{de.certificate.notYet}</p>
                  ) : (
                    <div className="mt-6">
                      <CertificateGate client={client} courseSlug={courseSlug} />
                    </div>
                  )
                }
              />
            )}
          </div>

          {/*
          The inline card is the wide layout's (P19-01). Below `sm` the
          floating module below replaces it — two progress panels on one
          430 px screen would be two places to read the same number, which is
          how they end up disagreeing.
        */}
          <div className="max-sm:hidden">
            <ProgressCard state={state} onResume={resume} />
          </div>

          {/*
          The same two numbers, floating, below `sm` (P19-01). Not restricted
          to the outline screen: its whole reason for existing is being the
          resume affordance *while a video is playing*, which is the one screen
          the inline card is not on.
        */}
          <StickyProgress state={state} onResume={resume} />
        </div>
      </TabbedPanel>
    </div>
  );
}

/**
 * Tell the host page what the server just said.
 *
 * Driven off `EnrolmentState` rather than off the player, and that is the whole
 * design: `EnrolmentState` only ever arrives from the API, so every figure a
 * host receives is one the CME gate agrees with. Wiring this to `timeupdate`
 * would emit a percentage the platform does not credit, and a customer's
 * dashboard would slowly diverge from their own participation report.
 *
 * Completion fires **once**. The state is re-read after every mutation and on
 * every screen change, so an unguarded effect would announce a finished course
 * on each one — and a host that sends a congratulations email on it would send
 * a dozen.
 */
function useAnnouncements(
  courseSlug: string,
  state: EnrolmentState | undefined,
  onProgress: ((detail: ProgressDetail) => void) | undefined,
  onCourseComplete: ((detail: CourseCompleteDetail) => void) | undefined,
): void {
  const announcedCompletion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (state === undefined) return;

    onProgress?.({
      courseSlug,
      watchedPercent: state.achievedWatchPercent,
      requiredWatchPercent: state.requiredWatchPercent,
      coursePercent: state.progress.percent,
      modulesCompleted: state.moduleCompletion.completed,
      modulesTotal: state.moduleCompletion.total,
      outstanding: state.outstanding,
      complete: state.complete,
    });

    if (state.completedAt === null) return;
    // Keyed by the timestamp, not a boolean: a learner who moves between two
    // finished courses in one mounted widget should produce one event each.
    const key = `${courseSlug}:${state.completedAt}`;
    if (announcedCompletion.current === key) return;
    announcedCompletion.current = key;
    onCourseComplete?.({ courseSlug, completedAt: state.completedAt });
  }, [courseSlug, state, onProgress, onCourseComplete]);
}

/*
 * The four wrappers below exist so each screen's own fetch has somewhere to
 * live without turning `Loaded` into a waterfall — a learner on the
 * Zertifizierung tab never pays for the Mediathek's request.
 */

/**
 * The customer's logo, when they have set one.
 *
 * Not a prop threaded from the element: a branding failure must not delay or
 * break the course render, and the colours are applied separately by
 * `element.ts` and do not depend on this at all. `useBranding` de-duplicates
 * the request, so the two places this renders and the catalogue hero share one
 * unauthenticated fetch rather than issuing three.
 *
 * `alt` is never derived: `parseBranding` refuses a logo without one, so if
 * this renders, the text came from the customer.
 */
function BrandLogo(props: { apiBase: string; projectSlug: string }) {
  const branding = useBranding(props.apiBase, props.projectSlug);

  if (branding.logoUrl === undefined) return null;

  return (
    <img
      src={branding.logoUrl}
      alt={branding.logoAlt ?? ""}
      className="max-h-12 w-auto"
      // The logo is a customer asset on a customer CDN; no reason to tell it
      // which page a physician is reading.
      referrerPolicy="no-referrer"
    />
  );
}

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
 */
function CourseShell(props: {
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
  children: React.ReactNode;
}) {
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

        <h1 className="mt-6 text-2xl font-bold text-brand-contrast sm:text-3xl">
          {props.course.title}
        </h1>
      </div>

      {/* Pulled up over the teal, the same device the course meta strip uses. */}
      <div className="-mt-14 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-4">{props.children}</div>

          <ModuleSidebar
            course={props.course}
            state={props.state}
            currentContentId={props.currentContentId}
            onOpen={props.onOpen}
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
      <StickyProgress state={props.state} onResume={props.onResume} />
    </div>
  );
}

function Player(props: {
  client: ReturnType<typeof createWidgetClient>;
  courseSlug: string;
  course: CourseDetail;
  state: EnrolmentState;
  contentId: string;
  onProgress: () => void;
  onOpen: (contentId: string) => void;
  onBack: () => void;
  onReporting: () => void;
}) {
  const lesson = useAsync(
    () => props.client.getLesson(props.courseSlug, props.contentId),
    [props.client, props.courseSlug, props.contentId],
  );

  if (lesson.loading) return <Spinner label={de.loading} />;
  if (lesson.data === undefined) {
    return (
      <ErrorNotice
        title={de.error.title}
        message={describeError(lesson.error, de.error)}
        retryLabel={de.content.back}
        onRetry={props.onBack}
      />
    );
  }

  return (
    <PlayerScreen
      client={props.client}
      courseSlug={props.courseSlug}
      course={props.course}
      state={props.state}
      lesson={lesson.data}
      onProgress={props.onProgress}
      onOpen={props.onOpen}
      onBack={props.onBack}
      onReporting={props.onReporting}
    />
  );
}

function QuizGate(props: {
  client: ReturnType<typeof createWidgetClient>;
  courseSlug: string;
  contentId: string;
  onPassed: () => void;
  onBack: () => void;
  onClaimPoints: () => void;
}) {
  const quiz = useAsync(
    () => props.client.getQuiz(props.courseSlug, props.contentId),
    [props.client, props.courseSlug, props.contentId],
  );

  if (quiz.loading) return <Spinner label={de.loading} />;
  if (quiz.data === undefined) {
    return (
      <ErrorNotice title={de.error.title} message={describeError(quiz.error, de.error)} />
    );
  }

  return (
    <QuizScreen
      client={props.client}
      courseSlug={props.courseSlug}
      quiz={quiz.data}
      onPassed={props.onPassed}
      onBack={props.onBack}
      onClaimPoints={props.onClaimPoints}
    />
  );
}

function EvaluationGate(props: {
  client: ReturnType<typeof createWidgetClient>;
  courseSlug: string;
  onSubmitted: () => void;
  onBack: () => void;
}) {
  const evaluation = useAsync(
    () => props.client.getEvaluation(props.courseSlug),
    [props.client, props.courseSlug],
  );

  if (evaluation.loading) return <Spinner label={de.loading} />;
  if (evaluation.data === undefined) {
    return (
      <ErrorNotice
        title={de.error.title}
        message={describeError(evaluation.error, de.error)}
      />
    );
  }

  return (
    <EvaluationScreen
      client={props.client}
      courseSlug={props.courseSlug}
      evaluation={evaluation.data}
      onSubmitted={props.onSubmitted}
      onBack={props.onBack}
    />
  );
}

function CertificateGate(props: {
  client: ReturnType<typeof createWidgetClient>;
  courseSlug: string;
}) {
  const certificate = useAsync(
    () => props.client.getCertificate(props.courseSlug),
    [props.client, props.courseSlug],
  );

  if (certificate.loading) return <Spinner label={de.loading} />;
  if (certificate.data === undefined) {
    return (
      <ErrorNotice
        title={de.error.title}
        message={describeError(certificate.error, de.error)}
      />
    );
  }

  return (
    <CertificatePanel
      client={props.client}
      courseSlug={props.courseSlug}
      certificate={certificate.data}
    />
  );
}

function Mediathek(props: {
  client: ReturnType<typeof createWidgetClient>;
  courseSlug: string;
}) {
  const library = useAsync(
    () => props.client.getMaterials(props.courseSlug),
    [props.client, props.courseSlug],
  );

  if (library.loading) return <Spinner label={de.loading} />;
  if (library.data === undefined) {
    return (
      <ErrorNotice
        title={de.error.title}
        message={describeError(library.error, de.error)}
      />
    );
  }

  return <MediathekPanel library={library.data} />;
}
