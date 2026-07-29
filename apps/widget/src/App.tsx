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
import { parseBranding, type Branding } from "@ds/domain";
import type { ContentSummary, CourseDetail, EnrolmentState } from "@ds/sdk";
import { createWidgetClient, isConfigured, type WidgetConfig } from "./api.js";
import { de } from "./locale/de.js";
import { describeError, useAsync, useEnrolment } from "./hooks.js";
import type { TokenProvider } from "./token.js";
import { CourseList } from "./components/CourseList.js";
import { CourseOutline } from "./components/CourseOutline.js";
import { ProgressCard, StickyMetaBar } from "./components/CourseHeader.js";
import { ExpertsTab } from "./components/ExpertsTab.js";
import { OverviewTab } from "./components/OverviewTab.js";
import { PlayerScreen } from "./components/PlayerScreen.js";
import { QuizScreen } from "./components/QuizScreen.js";
import { EvaluationScreen } from "./components/EvaluationScreen.js";
import { CompletionScreen } from "./components/CompletionScreen.js";
import { CertificatePanel } from "./components/CertificatePanel.js";
import { MediathekPanel } from "./components/MediathekPanel.js";
import { Button, ErrorNotice, Spinner } from "./components/primitives.js";

/** The four tabs of the course detail (layout §4.2). */
const TABS = ["overview", "speakers", "certification", "library"] as const;
type Tab = (typeof TABS)[number];

type Screen =
  | { kind: "outline" }
  | { kind: "lesson"; contentId: string }
  | { kind: "quiz"; contentId: string }
  | { kind: "evaluation" };

export interface AppProps extends WidgetConfig {
  readonly getToken: TokenProvider | undefined;
  /**
   * Announce a catalogue pick to the host page. Returns `false` when the host
   * has taken over navigation, in which case this widget stays put — see
   * `element.ts`. Absent in tests and in any host that does not route.
   */
  readonly onCourseOpen?: ((slug: string) => boolean) | undefined;
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
    onCourseOpen?: ((slug: string) => boolean) | undefined;
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

  if (selected === undefined) {
    return (
      <div className="space-y-6 p-4">
        <BrandLogo apiBase={apiBase} projectSlug={projectSlug} />
        <CourseList
          client={client}
          onOpen={(slug) => {
            // A host that routes cancels the event and replaces this element
            // with one pinned to the course. Switching screens here as well
            // would render the course twice, briefly.
            if (onCourseOpen !== undefined && !onCourseOpen(slug)) return;
            setSelected(slug);
          }}
        />
      </div>
    );
  }

  return (
    <Loaded
      apiBase={apiBase}
      projectSlug={projectSlug}
      courseSlug={selected}
      client={client}
      // Only offered when the learner arrived through the catalogue.
      onBackToCatalogue={courseSlug === "" ? () => setSelected(undefined) : undefined}
      onProgress={props.onProgress}
      onCourseComplete={props.onCourseComplete}
    />
  );
}

function Loaded(props: {
  apiBase: string;
  projectSlug: string;
  courseSlug: string;
  client: ReturnType<typeof createWidgetClient>;
  onBackToCatalogue: (() => void) | undefined;
  onProgress: ((detail: ProgressDetail) => void) | undefined;
  onCourseComplete: ((detail: CourseCompleteDetail) => void) | undefined;
}) {
  const { apiBase, projectSlug, courseSlug, client } = props;

  const [tab, setTab] = useState<Tab>("overview");
  const [screen, setScreen] = useState<Screen>({ kind: "outline" });

  const course = useAsync(() => client.getCourseBySlug(courseSlug), [client, courseSlug]);
  const enrolment = useEnrolment(client, courseSlug);

  useAnnouncements(courseSlug, enrolment.data, props.onProgress, props.onCourseComplete);

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

  const contentsById = new Map<string, ContentSummary>();
  for (const module of detail.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) contentsById.set(content.id, content);
    }
  }

  function open(contentId: string): void {
    const content = contentsById.get(contentId);
    if (content === undefined) return;
    setScreen(
      content.kind === "quiz"
        ? { kind: "quiz", contentId }
        : { kind: "lesson", contentId },
    );
  }

  const back = () => setScreen({ kind: "outline" });
  const refresh = () => enrolment.reload();

  const resumeId = state.resumeContentId;
  const resume = resumeId === null ? undefined : () => open(resumeId);

  return (
    <div className="space-y-6 p-4">
      <BrandLogo apiBase={apiBase} projectSlug={projectSlug} />

      {/*
        Layout §4.2. The bar stays put so the course's worth and the way back
        into it survive scrolling past several screens of Beschreibung.
      */}
      <StickyMetaBar
        course={detail}
        state={state}
        onBack={props.onBackToCatalogue}
        onResume={resume}
      />

      <nav
        className="flex flex-wrap gap-1 border-b border-gray-200"
        aria-label={detail.title}
      >
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            aria-current={tab === entry ? "page" : undefined}
            onClick={() => {
              setTab(entry);
              back();
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === entry
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-600"
            }`}
          >
            {de.tabs[entry]}
          </button>
        ))}
      </nav>

      {/*
        The progress card sits on all four tabs (layout §4.2) but not over the
        player, which has a progress panel of its own — two different readings
        of the same course on one screen would be one too many.
      */}
      {screen.kind === "outline" ? (
        <ProgressCard state={state} onResume={resume} />
      ) : null}

      {tab === "overview" && screen.kind === "outline" ? (
        <OverviewTab course={detail} state={state} />
      ) : tab === "speakers" && screen.kind === "outline" ? (
        <ExpertsTab experts={detail.experts} />
      ) : tab === "library" ? (
        <Mediathek client={client} courseSlug={courseSlug} key={state.progress.percent} />
      ) : screen.kind === "lesson" ? (
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
            setTab("certification");
            back();
          }}
        />
      ) : screen.kind === "quiz" ? (
        <QuizGate
          client={client}
          courseSlug={courseSlug}
          contentId={screen.contentId}
          onPassed={refresh}
          onBack={() => {
            refresh();
            back();
          }}
        />
      ) : screen.kind === "evaluation" ? (
        <EvaluationGate
          client={client}
          courseSlug={courseSlug}
          onSubmitted={() => {
            refresh();
            back();
          }}
          onBack={back}
        />
      ) : (
        <div className="space-y-8">
          <CourseOutline course={detail} state={state} onOpen={open} />

          {state.evaluationSubmitted ? null : (
            <Button variant="secondary" onClick={() => setScreen({ kind: "evaluation" })}>
              {de.evaluation.title}
            </Button>
          )}

          <CompletionScreen
            client={client}
            courseSlug={courseSlug}
            state={state}
            onCompleted={refresh}
          />

          {state.completedAt === null ? (
            <p className="text-sm text-gray-500">{de.certificate.notYet}</p>
          ) : (
            <CertificateGate client={client} courseSlug={courseSlug} />
          )}
        </div>
      )}
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
 * Its own tiny fetch rather than a prop threaded from the element, so a
 * branding failure cannot delay or break the course render — the colours are
 * applied separately by `element.ts` and do not depend on this at all.
 *
 * `alt` is never derived: `parseBranding` refuses a logo without one, so if
 * this renders, the text came from the customer.
 */
function BrandLogo(props: { apiBase: string; projectSlug: string }) {
  const [branding, setBranding] = useState<Branding | undefined>();

  const { apiBase, projectSlug } = props;

  useEffect(() => {
    let cancelled = false;
    fetch(new URL("/branding", apiBase), {
      headers: { accept: "application/json", "x-ds-project": projectSlug },
    })
      .then((response) => (response.ok ? response.json() : {}))
      .then((body: unknown) => {
        if (!cancelled) setBranding(parseBranding(body));
      })
      .catch(() => {
        // An unbranded header is not something a learner can act on.
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, projectSlug]);

  if (branding?.logoUrl === undefined) return null;

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
