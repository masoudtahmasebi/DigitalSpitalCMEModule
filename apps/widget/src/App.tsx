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
import type { OpenIntent } from "./intent.js";
import { indexTitles, nextAvailableContent, passedQuizScore } from "./player.js";
import {
  clearCourseFragment,
  decode,
  decodeCourseSlug,
  encode,
  type CourseTab,
  type WidgetRoute,
} from "./route.js";
import { CONTENT, MAIN_ASIDE } from "./layout.js";
import { CourseList } from "./components/CourseList.js";
import { CertificationTab } from "./components/CertificationTab.js";
import { ProgressCard, StickyMetaBar } from "./components/CourseHeader.js";
import { StickyProgress } from "./components/StickyProgress.js";
import { ExpertsTab } from "./components/ExpertsTab.js";
import { OverviewTab } from "./components/OverviewTab.js";
import { BrandLogo } from "./components/BrandLogo.js";
import { CourseShell } from "./components/CourseShell.js";
import { PlayerScreen } from "./components/PlayerScreen.js";
import { QuizScreen } from "./components/QuizScreen.js";
import { EvaluationScreen } from "./components/EvaluationScreen.js";
import { CompletionScreen } from "./components/CompletionScreen.js";
import { EfnPanel } from "./components/EfnPanel.js";
import { DeliveryAddressPanel } from "./components/DeliveryAddressPanel.js";
import { CertificatePanel } from "./components/CertificatePanel.js";
import { useCertificateDownload } from "./certificate-download.js";
import { MediathekPanel } from "./components/MediathekPanel.js";
import {
  ErrorNotice,
  SignedOutNotice,
  Spinner,
  TabbedPanel,
} from "./components/primitives.js";

/** The four tabs of the course detail (layout §4.2). */
const TABS = [
  "overview",
  "speakers",
  "certification",
  "library",
] as const satisfies readonly CourseTab[];
type Tab = CourseTab;

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
/*
 * The three ways a course can be opened, in `intent.ts` since P168-04 — the
 * catalogue card, this file and `element.ts` all name it and none of them may
 * import the others.
 */
export type { OpenIntent };

/**
 * The screen a piece of content opens on.
 *
 * Module-level so the outline's click and the catalogue's resume cannot drift:
 * a quiz that opened as a lesson would render a player with no video in it.
 */
/**
 * A `Screen` for an address, and the address for a `Screen` (P82-04).
 *
 * Both live beside `screenFor` because they share its one hard rule: whether a
 * content is a lesson or a quiz is a fact about the course, not about the URL.
 * `route.ts` deliberately encodes neither, so this is the single place that
 * decides — and a link to a content that has since been deleted resolves to
 * nothing here rather than to a player with no video in it.
 */
function screenFromRoute(course: CourseDetail, route: WidgetRoute): Screen | undefined {
  switch (route.kind) {
    case "outline":
      return { kind: "outline" };
    case "content":
      return screenFor(course, route.contentId);
    case "evaluation":
      /*
       * "outline" rather than "reporting": arriving by link is not the same act
       * as arriving from a passed exam. The `then` in the quiz flow exists so a
       * physician who just earned their points is carried on to the
       * Punktemeldung; somebody opening a bookmark has asked for the evaluation
       * and nothing more.
       */
      return { kind: "evaluation", then: "outline" };
    case "reporting":
      return { kind: "reporting" };
  }
}

/**
 * The address for a screen — and, on the outline, for which tab of it (P123-01).
 *
 * `tab` is a parameter rather than being read from the screen because a `Screen`
 * deliberately does not carry it: the tab row exists only on the outline, and
 * threading it through the player and the exam would put a field on four screens
 * that three of them must ignore.
 */
function routeForScreen(screen: Screen, tab: CourseTab): WidgetRoute {
  switch (screen.kind) {
    case "outline":
      return { kind: "outline", tab };
    case "lesson":
    case "quiz":
      return { kind: "content", contentId: screen.contentId };
    case "evaluation":
      return { kind: "evaluation" };
    case "reporting":
      return { kind: "reporting" };
  }
}

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
   * The host page's statement about **its own** session (P99-03).
   *
   * `undefined` when the page said nothing, which is every host that has not
   * been updated — those keep the previous behaviour exactly. `false` is a
   * page telling us nobody is signed in, and it is believed for one purpose
   * only: deciding what to render. It confers no access. Every request still
   * carries a token the API validates against Keycloak (§4 invariant 2), so a
   * page claiming `true` gains a caller nothing at all.
   */
  readonly signedIn?: boolean | undefined;
  /** Where the host signs somebody in. Rendered as a link, never fetched. */
  readonly signInUrl?: string | undefined;
  /**
   * Announce a catalogue pick to the host page. Returns `false` when the host
   * has taken over navigation, in which case this widget stays put — see
   * `element.ts`. Absent in tests and in any host that does not route.
   */
  readonly onCourseOpen?: ((slug: string, intent: OpenIntent) => boolean) | undefined;
  /**
   * Where a course named by the `course` attribute opens.
   *
   * `"resume"` lands in the content the learner left off at, which is how a
   * routing host carries the catalogue's **Fortbildung fortsetzen** across its
   * own navigation. Defaults to the course's start page.
   */
  readonly openAt?: OpenIntent | undefined;
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
  /** Forwarded to the client, opaque here (P105-01). */
  readonly profileHint?: string | undefined;
  readonly watchedPercent: number;
  readonly requiredWatchPercent: number;
  readonly coursePercent: number;
  readonly modulesCompleted: number;
  readonly modulesTotal: number;
  readonly outstanding: readonly string[];
  /**
   * The Fortbildung itself is finished — videos and Lernerfolgskontrolle
   * (P51-01). True before `complete` whenever the Evaluationsbogen or the EFN
   * are still to come, which on this platform is the normal order of events.
   */
  readonly courseComplete: boolean;
  /** Certified: the CME point is earned and reported. */
  readonly complete: boolean;
}

export interface CourseCompleteDetail {
  readonly courseSlug: string;
  /** Forwarded to the client, opaque here (P105-01). */
  readonly profileHint?: string | undefined;
  readonly completedAt: string;
}

export function App(props: AppProps) {
  /*
   * Three states that used to be one, and the one was the wrong one (P99-03).
   *
   * Until now anything that failed to produce a token rendered
   * `error.misconfigured` — *"wenden Sie sich an den Betreiber der Seite"*. On
   * the MEDICE site the commonest reason for no token is simply that the
   * visitor has not logged in, so a physician was being told to ring the
   * webmaster about their own sign-in.
   *
   * The host page knows which it is, and now says so on the element. Order
   * matters here: `signedIn === false` is checked **first**, because a page
   * that says nobody is signed in has told us why there is no token, and
   * calling it a misconfiguration on top of that would be a second wrong
   * answer.
   *
   * This is presentation and nothing else. The API still validates every
   * bearer against Keycloak's JWKS, so a page asserting `signed-in="yes"` buys
   * a caller precisely nothing (CLAUDE.md §4 invariant 2).
   */
  if (props.signedIn === false) {
    return (
      <SignedOutNotice
        title={de.signedOut.title}
        message={de.signedOut.message}
        actionLabel={de.signedOut.action}
        signInUrl={props.signInUrl}
      />
    );
  }

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
  const { profileHint } = props;

  const client = useMemo(
    () =>
      createWidgetClient(
        {
          apiBase,
          projectSlug,
          courseSlug,
          ...(profileHint === undefined ? {} : { profileHint }),
        },
        getToken,
      ),
    [apiBase, projectSlug, courseSlug, profileHint, getToken],
  );

  // The attribute wins for the whole lifetime of the element: a page that
  // names a course is showing that course, and there is no back link to a
  // catalogue the host page never asked for.
  /*
   * …or the course the address names, on a page that names none (P156-02).
   *
   * Every route this widget encodes is course-relative, and until now the
   * course came only from the attribute. On a catalogue embed that attribute is
   * absent, so a reload rendered the catalogue and the fragment — which named a
   * content inside the course the learner had opened — could never be applied:
   * the component that reads it was not mounted. Reported three times, most
   * recently as "when i refresh … again the main page opens."
   *
   * The attribute still wins. A page that names a course is showing that
   * course, and a fragment must not be able to move a learner to a different
   * one on somebody else's page.
   */
  const [selected, setSelected] = useState<string | undefined>(
    courseSlug === "" ? decodeCourseSlug(window.location.hash) : courseSlug,
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
      addressCourseSlug={courseSlug === "" ? selected : undefined}
      // Only offered when the learner arrived through the catalogue.
      onBackToCatalogue={
        courseSlug === ""
          ? () => {
              /*
               * The address leaves with the learner (DEP-33).
               *
               * Without this the fragment went on naming the course — and the
               * tab within it — while the catalogue was on screen, so a reload
               * put them back inside the course they had just left. The screen
               * changing without the URL changing is §9.8's third symptom, and
               * the one that only shows up on F5.
               */
              clearCourseFragment();
              setSelected(undefined);
            }
          : undefined
      }
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
  /** Where this course opens — see `OpenIntent`. */
  openAt: OpenIntent;
  /**
   * The course to write into the fragment, or `undefined` when the host page
   * already names it on the element (P156-02).
   *
   * Present exactly when the learner arrived through the catalogue, which is
   * the case where the address is the only record of which course they are in.
   */
  addressCourseSlug: string | undefined;
  onBackToCatalogue: (() => void) | undefined;
  onProgress: ((detail: ProgressDetail) => void) | undefined;
  onCourseComplete: ((detail: CourseCompleteDetail) => void) | undefined;
}) {
  const { apiBase, projectSlug, courseSlug, client, addressCourseSlug } = props;

  // De-duplicated with the logo's fetch and the catalogue's — see branding.ts.
  const branding = useBranding(apiBase, projectSlug);

  const [tab, setTab] = useState<Tab>("overview");
  const [screen, setScreen] = useState<Screen>({ kind: "outline" });

  /*
   * Whether the fragment has been read yet (P82-04).
   *
   * The address is applied once the course has loaded, because turning
   * `#ds/inhalt/<id>` into a screen needs `screenFor` to know whether that
   * content is a lesson or a quiz. Until then there is nothing to apply and the
   * flag keeps the effect from re-applying an address the learner has since
   * navigated away from.
   */
  const addressApplied = useRef(false);

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
  /*
   * The address, in both directions (P82-04).
   *
   * **In**, once — and before the resume intent below, which is why this
   * effect sets `resumed` too. A learner who followed a link to a specific
   * section must land on that section; letting "Fortbildung fortsetzen" also
   * fire would move them somewhere else a moment after the page settled.
   *
   * **Out**, on every change, and only for fragments that are ours: `decode`
   * answers `undefined` for a host page's own anchor and this leaves it alone.
   */
  useEffect(() => {
    if (addressApplied.current || course.data === undefined) return;
    addressApplied.current = true;

    const route = decode(window.location.hash);
    if (route === undefined) return;

    const target = screenFromRoute(course.data, route);
    if (target === undefined) return;
    resumed.current = true;
    if (route.kind === "outline") setTab(route.tab);
    setScreen(target);
  }, [course.data]);

  /*
   * Back and forward.
   *
   * Without this the fragment would describe where the learner is and the
   * browser's own buttons would still leave the page — which is two thirds of
   * the reason §9.8 exists.
   */
  useEffect(() => {
    const onHashChange = (): void => {
      const detail = course.data;
      if (detail === undefined) return;
      const route = decode(window.location.hash);
      if (route === undefined) return;
      const target = screenFromRoute(detail, route);
      if (target === undefined) return;
      if (route.kind === "outline") setTab(route.tab);
      setScreen(target);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [course.data]);

  /*
   * And out again, so the address always describes the screen.
   *
   * `replaceState` rather than assigning `location.hash`, for two reasons. It
   * does not fire `hashchange`, so the effect above cannot be woken by this
   * one; and it does not push an entry, so opening a lesson from the outline
   * leaves one history step rather than two — the difference between one press
   * of Back going where the learner expects and two.
   *
   * The first render is skipped: writing the outline's address before the
   * fragment has been read would erase the very link that was followed.
   */
  useEffect(() => {
    if (!addressApplied.current) return;
    /*
     * The course goes into the address only when the host page does not name
     * one (P156-02). On a single-course embed the attribute is the course and
     * repeating it in the fragment would put the same fact in two places, where
     * they can disagree; on a catalogue embed it is the only record of which
     * course the learner is in, and without it a reload loses them.
     */
    const fragment = `#${encode(routeForScreen(screen, tab), addressCourseSlug)}`;
    if (window.location.hash === fragment) return;
    window.history.replaceState(null, "", fragment);
  }, [screen, tab, addressCourseSlug]);

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

  /*
   * `open-at="certify"` — the catalogue's **CME-Punkte geltend machen**
   * (P168-04).
   *
   * Once, like the resume intent above and for the same reason: the learner may
   * navigate away from the Punktemeldung, and re-applying the intent on the
   * next state refresh would put them back on it.
   *
   * The server's answer decides whether it is honoured. `courseComplete` with
   * the completion still open is the pair `POST /completion` accepts on, so a
   * card rendered before the last module was finished — or a hand-written
   * attribute — lands on the course page instead of on a form that would be
   * refused (§9.2). The evaluation comes first when it is outstanding, exactly
   * as it does from the quiz-passed screen.
   */
  const certified = useRef(false);
  useEffect(() => {
    if (props.openAt !== "certify" || certified.current) return;
    const state = enrolment.data;
    if (state === undefined) return;
    certified.current = true;
    if (!state.courseComplete || state.completedAt !== null) return;
    setScreen(
      state.evaluationSubmitted
        ? { kind: "reporting" }
        : { kind: "evaluation", then: "reporting" },
    );
  }, [props.openAt, enrolment.data]);

  /*
   * `open-at="certificate"` — the catalogue's finished card (P176-02).
   *
   * P168-04 gave a certified course its own line on the card,
   * "Abgeschlossen – Teilnahmebescheinigung verfügbar", and then left the
   * physician to find the document themselves: *"where can one download it?"*
   * The Teilnahmebescheinigung is on the Zertifizierung tab, so that is where
   * this lands — the tab, not a download, because the tab is what holds the
   * accreditation, the conditions and the button, and a file that arrives with
   * no page around it is a file nobody can check.
   *
   * Once, like the two intents above, and granted only on the server's own
   * `completedAt`: before a completion is recorded there is no certificate to
   * fetch, and the tab would draw "noch nicht verfügbar" under a promise the
   * card had just made.
   */
  /*
   * Above every early return, because it is a hook (P195-01).
   *
   * It was first written beside `downloadCertificate` further down, which is
   * after the loading spinner returns — so the first render made no `useState`
   * call and the second made two, and React refused: "Rendered more hooks than
   * during the previous render." The *decision* still lives beside the claim
   * rule; only the hook has to be up here.
   */
  const certificate = useCertificateDownload(client, courseSlug);

  const certificateOpened = useRef(false);
  useEffect(() => {
    if (props.openAt !== "certificate" || certificateOpened.current) return;
    const state = enrolment.data;
    if (state === undefined) return;
    certificateOpened.current = true;
    if (state.completedAt === null) return;
    setScreen({ kind: "outline" });
    setTab("certification");
  }, [props.openAt, enrolment.data]);

  /*
   * The spinner is for the **first** load only.
   *
   * `refresh()` sets `loading` again, and this used to be a bare
   * `course.loading || enrolment.loading` — so every mutation replaced the
   * whole screen with a spinner and then rebuilt it. React unmounts the tree
   * to do that, which destroys every screen's local state, and the widget
   * refreshes after *everything*:
   *
   *   * passing the quiz reset `QuizScreen` to its intro, so the result the
   *     learner had just earned was on screen for one frame — found by walking
   *     the exam in a browser at 430 px, which is the only way it could have
   *     been found;
   *   * `onProgress` fires on every watch-progress flush, so a running video
   *     was torn down and remounted mid-playback, losing the playhead on a
   *     platform whose whole gate is how much of it was watched.
   *
   * A refetch with data already in hand keeps rendering what it has. The new
   * state replaces it when it arrives, which is what `EnrolmentState` being the
   * only source of truth actually requires — not a spinner in between.
   */
  const firstLoad =
    (course.loading && course.data === undefined) ||
    (enrolment.loading && enrolment.data === undefined);
  if (firstLoad) {
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
   * The next section a learner may open after finishing this one (P82-01).
   *
   * `nextAvailableContent` is the same rule the player's „Weiter: ‹Abschnitt›"
   * button uses, called with the same arguments — one implementation, two
   * callers. A second "what comes next" written for the quiz screen would drift
   * from the player's the first time either changed, and the two disagreeing
   * about where a physician goes next is the kind of difference nobody notices
   * until it is on a CME record.
   *
   * Undefined whenever the enrolment or the course has not loaded, or the
   * server has nothing open — the caller renders no button rather than one
   * pointing nowhere.
   */
  function nextAfter(
    contentId: string,
  ): { readonly title: string; readonly open: () => void } | undefined {
    if (detail === undefined || state === undefined) return undefined;
    const target = nextAvailableContent(detail, state, contentId);
    if (target === undefined) return undefined;
    return { title: target.title, open: () => open(target.id) };
  }

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
   * The way to the Punktemeldung from the course itself (P168-03).
   *
   * The same rule as the quiz-passed screen's **CME-Punkte geltend machen**,
   * and deliberately the same two decisions rather than a second opinion about
   * them:
   *
   *   * offered only while `courseComplete` and the completion is still open,
   *     because that is exactly what `POST /completion` accepts — a button that
   *     ends in a 409 after somebody has typed their EFN is worse than no
   *     button (§9.2);
   *   * the Evaluationsbogen first when it is outstanding, because the API
   *     refuses a completion without one, so sending them straight to the EFN
   *     field would be a refusal *after* the personal data.
   *
   * It exists because the client could reach `#…/punktemeldung` by URL and not
   * from the course: *"if I click on back button and I visit the overview list
   * of courses page and enter the course, I don't have a button which takes me
   * to this page."* The only route was sitting the exam again — which opens it,
   * and is not the act they came back to perform.
   */
  const claimPoints =
    state.courseComplete && state.completedAt === null
      ? () => {
          refresh();
          setScreen(
            state.evaluationSubmitted
              ? { kind: "reporting" }
              : { kind: "evaluation", then: "reporting" },
          );
        }
      : undefined;

  /*
   * The Punktemeldung step's **third** state (P195-02).
   *
   * `claimPoints` above is the open state. Once `completedAt` is set the act is
   * finished, and every screen that drew the button drew nothing — except the
   * sidebar, which drew the imperative *CME-Punkte geltend machen* under a
   * checkmark. A completed step labelled with the act that completed it, and no
   * route to what the act produced (§9.4).
   *
   * The condition is `completedAt !== null` and nothing else, because that is
   * already what the Zertifizierung tab reads to choose between "noch nicht
   * verfügbar" and the certificate itself. Two readings of "does a certificate
   * exist" is §9.10b, and the quiet direction — a screen offering a download
   * for a record that is not there — is the expensive one.
   *
   * It really downloads. A control labelled *herunterladen* that navigates to a
   * tab holding a download button is the false promise §9.4 exists to prevent,
   * so it calls the same hook `CertificatePanel` does.
   */
  const hasCertificate = state.completedAt !== null;
  /*
   * Two affordances, one rule (P195-02).
   *
   * Where the Zertifizierung tab is a click away — the course detail's progress
   * card and its floating counterpart — the finished step **opens the tab**,
   * which is P176-02's settled answer and, just as importantly, is what keeps
   * this from re-creating the defect it fixes: both cards render *on* that tab,
   * so a second "Teilnahmebescheinigung herunterladen" would sit beside
   * `CertificatePanel`'s own. Two controls with one accessible name on one
   * screen is what failed deploy 120's journey.
   *
   * On the player and exam screens there is no tab in reach, so those download
   * for real.
   */
  const downloadCertificate = hasCertificate ? certificate.start : undefined;
  const openCertificate = hasCertificate
    ? () => {
        setScreen({ kind: "outline" });
        setTab("certification");
      }
    : undefined;

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
    /*
     * Full width (P190-01). `CourseShell` bleeds its teal band to the edges of
     * the page and applies the content column to the band's contents and to
     * the white panel below it, so nothing here may centre first.
     */
    const shell = (body: React.ReactNode, currentContentId: string, progress = false) => (
      <div className="py-4">
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
          progress={progress}
          /*
            The sidebar's **CME-Punkte geltend machen** row (layout 05–12).

            `claimPoints` and not a second reading of it: the course page's
            progress card, the floating module and this row must agree about
            whether there is a point left to claim, and P170-02 already
            established what that condition is.
          */
          onClaimPoints={claimPoints}
          onDownloadCertificate={downloadCertificate}
          certificateDownloading={certificate.busy}
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
        true,
      );
    }

    if (screen.kind === "quiz") {
      return shell(
        <QuizGate
          client={client}
          courseSlug={courseSlug}
          contentId={screen.contentId}
          /*
           * The exam's own title, from the catalogue (P87-02).
           *
           * `indexTitles` is the one place the two responses are zipped, so
           * this reads the same map the outline draws from — a second lookup
           * would be a second answer to "what is this exam called", on two
           * screens a physician sees side by side.
           */
          examTitle={
            indexTitles(detail).contents.get(screen.contentId)?.title ?? de.quiz.exam
          }
          passedScorePercent={passedQuizScore(state, screen.contentId)}
          /*
           * Certified, from the server (P169-01). `submit` refuses an attempt
           * on such an enrolment, so the screen must not offer one — the same
           * §9.2 rule as `onClaimPoints` two properties down, in the other
           * direction: that one withholds a control the API would refuse to
           * *start*, this one withholds a control it would refuse to *finish*.
           */
          certified={state.completedAt !== null}
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
          /*
           * Offered only when the API would accept it (P82-01).
           *
           * `courseComplete` is the server's own answer to "has this physician
           * watched what they must and passed the Lernerfolgskontrolle", which
           * is exactly the pair `POST /completion` refuses on. Passing the
           * callback unconditionally is what produced a 409 after a learner
           * had typed their EFN — the worst place to be refused, because the
           * refusal arrives after the personal data.
           */
          /*
           * And not once the point has been claimed (P170-02).
           *
           * `courseComplete` alone was enough while this button only ever
           * appeared on the screen you land on straight after passing. Since
           * P170-02 the *intro* offers it too — the screen a physician returns
           * to weeks later — and for a certified enrolment "geltend machen"
           * describes something already done. Same condition as the course
           * page's own button (P168-02), so the two cannot disagree about
           * whether there is a point left to claim.
           */
          /*
           * `claimPoints` itself, not a second copy of its condition and body
           * (P195-04). The comment above has always said the two "cannot
           * disagree about whether there is a point left to claim" — and they
           * were two expressions, kept in step by hand. §9.10b: a value with
           * one home and a second reader that wrote its own.
           */
          onClaimPoints={claimPoints}
          onDownloadCertificate={downloadCertificate}
          certificateDownloading={certificate.busy}
          onNext={nextAfter(screen.contentId)}
          /*
            The drawing's congratulation on page 07, and only where it is true.
            `moduleCompletion` is the server's — the same pair the progress card
            renders as a sentence — so this is not a second reading of what is
            finished, it is the one reading compared with itself.
          */
          allModulesDone={
            state.moduleCompletion.completed === state.moduleCompletion.total
          }
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
    /*
      On the shared content column, not capped at its panel's width (P190-01,
      correcting DEP-24).

      DEP-24 measured `detailseite-uebersicht.png` and found the tab panel at
      x 262…1329 — 1068 px — which is right, and the 01.09.2026 export agrees
      to within two pixels (261…1331). What it then did was cap the **screen**
      at that figure, via `max-w-6xl`. The screen is wider than its panel: the
      *Ihr Fortschritt* card sits at x 1374…1656 on the same page, entirely to
      the right of 1329. A cap at 1152 has to fit both, so the panel came out
      at roughly 808 px and the card was squeezed beside it — 246 px narrower
      than the drawing, in the shape of a correct measurement of the wrong box.

      The screen is the content column: 261…1659, 1398 px, the same one the
      catalogue's panel and the player's white panel are on. The panel's own
      1070 px then falls out of `MAIN_ASIDE` rather than being imposed:
      1398 − 40 (`gap-10`) − 288 (`18rem`) = 1070.

      The hero inside `StickyMetaBar` bleeds past all of this, which is why the
      column is applied part by part below rather than to this element.
    */
    <div className="space-y-6 py-4">
      <div className={CONTENT}>
        <BrandLogo apiBase={apiBase} projectSlug={projectSlug} />
      </div>

      {/*
        Full width, and it insets its own parts: the hero bleeds to the edges
        of the page and the meta strip under it sits on the column — see the
        note in `CourseHeader`, and `layout.ts` for why a negative margin
        cannot do this from inside a centred column.
      */}
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
      <div className={CONTENT}>
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
          layout draws for them — a teal masthead and the Fortbildungsfortschritt, with
          no tab row (#61).
        */}
          <div className={MAIN_ASIDE}>
            {/* `max-sm:` drops the top border and the top rounding: below `sm` the
            heading `TabbedPanel` renders supplies both, and two borders meeting
            draw a 2 px rule across what the layout has as one line. */}
            {/* `border-brand-100`, not `border-gray-100` (DEP-28): the active tab
            standing on this panel's top edge carries the same colour, and the
            whole point of the folder-tab shape is that the two are one outline.
            A teal tab meeting a grey panel draws the seam instead of hiding it. */}
            <div className="min-w-0 rounded-2xl rounded-tl-none border border-brand-100 bg-white p-5 shadow-sm max-sm:rounded-t-none max-sm:border-t-0 max-sm:border-brand-500 sm:p-6">
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
                 * the player's Fortbildungsfortschritt is the course's navigation, and a
                 * second one on the detail page was a way past the sequential
                 * gate that the layout deliberately does not offer.
                 */
                <CertificationTab
                  course={detail}
                  certificate={
                    <>
                      {state.completedAt === null ? (
                        <p className="mt-6 text-sm text-gray-500">
                          {de.certificate.notYet}
                        </p>
                      ) : (
                        <div className="mt-6">
                          <CertificateGate client={client} courseSlug={courseSlug} />
                        </div>
                      )}
                      {/*
                       * The physician's own EFN (P179-03), drawn whether or not
                       * they have finished.
                       *
                       * P54-02 put the correction on the Punktemeldung form, and
                       * the widget stops showing that form the moment a
                       * completion is recorded — so from exactly the point the
                       * number starts to matter, its owner could no longer see
                       * or fix it. The panel decides for itself whether this
                       * course reports anything at all, so a Fortbildung without
                       * points draws nothing.
                       */}
                      <EfnPanel client={client} />
                      {/* Where that certificate is sent, beside the number it
                        carries — P183-03. */}
                      <DeliveryAddressPanel client={client} courseSlug={courseSlug} />
                    </>
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
              <ProgressCard
                state={state}
                onResume={resume}
                onClaimPoints={claimPoints}
                onOpenCertificate={openCertificate}
              />
            </div>

            {/*
          The same two numbers, floating, below `sm` (P19-01). Not restricted
          to the outline screen: its whole reason for existing is being the
          resume affordance *while a video is playing*, which is the one screen
          the inline card is not on.
        */}
            <StickyProgress
              state={state}
              onResume={resume}
              onClaimPoints={claimPoints}
              onOpenCertificate={openCertificate}
            />
          </div>
        </TabbedPanel>
      </div>
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
      courseComplete: state.courseComplete,
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
  /** This exam's own name, from the catalogue tree — see `QuizScreen` (P87-02). */
  examTitle: string;
  /** Absent while the course is not complete — see `QuizScreen` (P82-01). */
  passedScorePercent: number | undefined;
  /** The enrolment is certified, so the API refuses another attempt (P169-01). */
  certified: boolean;
  onClaimPoints: (() => void) | undefined;
  /** The finished Punktemeldung's affordance (P195-03). */
  onDownloadCertificate: (() => void) | undefined;
  certificateDownloading: boolean;
  onNext: { readonly title: string; readonly open: () => void } | undefined;
  /** The server's own module counts, equal — see `QuizScreen` (P190-03). */
  allModulesDone: boolean;
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
      examTitle={props.examTitle}
      passedScorePercent={props.passedScorePercent}
      certified={props.certified}
      onPassed={props.onPassed}
      onBack={props.onBack}
      onClaimPoints={props.onClaimPoints}
      onDownloadCertificate={props.onDownloadCertificate}
      certificateDownloading={props.certificateDownloading}
      onNext={props.onNext}
      allModulesDone={props.allModulesDone}
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
