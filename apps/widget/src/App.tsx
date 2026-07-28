/**
 * The widget's root (P5).
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

import { useEffect, useMemo, useState } from "react";
import { parseBranding, type Branding } from "@ds/domain";
import type { ContentSummary } from "@ds/sdk";
import { createWidgetClient, isConfigured, type WidgetConfig } from "./api.js";
import { de } from "./locale/de.js";
import { describeError, useAsync, useEnrolment } from "./hooks.js";
import type { TokenProvider } from "./token.js";
import { CourseOutline } from "./components/CourseOutline.js";
import { LessonScreen } from "./components/LessonScreen.js";
import { QuizScreen } from "./components/QuizScreen.js";
import { EvaluationScreen } from "./components/EvaluationScreen.js";
import { CompletionScreen } from "./components/CompletionScreen.js";
import { CertificatePanel } from "./components/CertificatePanel.js";
import { MediathekPanel } from "./components/MediathekPanel.js";
import { Button, ErrorNotice, ProgressRing, Spinner } from "./components/primitives.js";

type Tab = "certification" | "library";
type Screen =
  | { kind: "outline" }
  | { kind: "lesson"; contentId: string }
  | { kind: "quiz"; contentId: string }
  | { kind: "evaluation" };

export interface AppProps extends WidgetConfig {
  readonly getToken: TokenProvider | undefined;
}

export function App(props: AppProps) {
  // A missing attribute is a page-integration mistake, not a learner problem,
  // so it gets its own message rather than a wall of failed requests.
  if (!isConfigured(props) || props.getToken === undefined) {
    return <ErrorNotice title={de.error.title} message={de.error.misconfigured} />;
  }
  return <Loaded {...props} getToken={props.getToken} />;
}

function Loaded(props: WidgetConfig & { getToken: TokenProvider }) {
  const { apiBase, projectSlug, courseSlug, getToken } = props;

  const client = useMemo(
    () => createWidgetClient({ apiBase, projectSlug, courseSlug }, getToken),
    [apiBase, projectSlug, courseSlug, getToken],
  );

  const [tab, setTab] = useState<Tab>("certification");
  const [screen, setScreen] = useState<Screen>({ kind: "outline" });

  const course = useAsync(() => client.getCourseBySlug(courseSlug), [client, courseSlug]);
  const enrolment = useEnrolment(client, courseSlug);

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

  return (
    <div className="space-y-6 p-4">
      <header className="space-y-3">
        <BrandLogo apiBase={apiBase} projectSlug={projectSlug} />
        <h1 className="text-xl font-bold text-gray-900">{detail.title}</h1>

        <div className="flex items-center gap-4">
          <ProgressRing
            percent={state.progress.percent}
            label={de.overview.moduleProgress(
              state.moduleCompletion.completed,
              state.moduleCompletion.total,
            )}
          />
          <div className="space-y-1 text-sm text-gray-700">
            <p>
              {de.overview.moduleProgress(
                state.moduleCompletion.completed,
                state.moduleCompletion.total,
              )}
            </p>
            <p className="text-gray-600">
              {de.overview.watchProgress(
                state.achievedWatchPercent,
                state.requiredWatchPercent,
              )}
            </p>
            {state.completedAt === null ? null : (
              <p className="font-medium text-status-completed">{de.overview.complete}</p>
            )}
          </div>
        </div>

        {screen.kind === "outline" && state.resumeContentId !== null ? (
          <Button onClick={() => open(state.resumeContentId as string)}>
            {state.progress.completedCount === 0 ? de.overview.start : de.overview.resume}
          </Button>
        ) : null}
      </header>

      <nav
        className="flex gap-1 border-b border-gray-200"
        aria-label={de.tabs.certification}
      >
        {(["certification", "library"] as const).map((entry) => (
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
            {entry === "certification" ? de.tabs.certification : de.tabs.library}
          </button>
        ))}
      </nav>

      {tab === "library" ? (
        <Mediathek client={client} courseSlug={courseSlug} key={state.progress.percent} />
      ) : screen.kind === "lesson" ? (
        <Lesson
          client={client}
          courseSlug={courseSlug}
          contentId={screen.contentId}
          onProgress={refresh}
          onBack={() => {
            refresh();
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

function Lesson(props: {
  client: ReturnType<typeof createWidgetClient>;
  courseSlug: string;
  contentId: string;
  onProgress: () => void;
  onBack: () => void;
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
      />
    );
  }

  return (
    <LessonScreen
      client={props.client}
      courseSlug={props.courseSlug}
      lesson={lesson.data}
      onProgress={props.onProgress}
      onBack={props.onBack}
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
