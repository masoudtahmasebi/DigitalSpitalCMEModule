/**
 * What a DocCheck visitor sees (P213-01).
 *
 * ## The client's words
 *
 * > when the user logs in with doccheck they are able to see the course list,
 * > and they can see course descriptions, but if they want to participate, they
 * > will get a popup, that for this feature you have to login with medice login
 *
 * ## What decides whether this renders at all
 *
 * Not the host page. `App` reaches here whenever the page says nobody is signed
 * in — which is what `class-ds-lms-renderer.php` writes for a DocCheck visitor,
 * because `DS_LMS_Token_Source::available()` is false for them — and the first
 * thing this does is **ask the API**. The project's `doccheck_login_allowed`
 * decides, server-side; a project that has not set it answers 404 and this
 * falls back to `SignedOutNotice`, which is exactly the screen such a visitor
 * saw before this existed.
 *
 * That fallback is also the failure mode for a network error, and deliberately
 * so: there is nothing a physician could do about the difference, and the
 * previous behaviour is the safe answer to "we do not know".
 *
 * ## Why it has its own component tree and not a flag through the real one
 *
 * `Loaded` enrols on mount — `useEnrolment` calls `PUT /courses/{slug}/enrolment`
 * before it renders anything — and every screen below it reads an
 * `EnrolmentState`. A preview reader has no enrolment, because they have no
 * account. Threading "there is no enrolment" through those screens would put a
 * branch in every one of them, and the branch nobody added would be the one
 * that made a request the API refuses (§9.2).
 *
 * What **is** shared is everything that describes a course rather than a
 * learner: `CourseList`, `StickyMetaBar`, `OverviewTab`, `ExpertsTab` and
 * `CertificationTab` are the same components the signed-in screens use, so the
 * two audiences cannot end up reading two different catalogues.
 *
 * The Mediathek tab is **not** offered. Its contents are a course's material
 * files, fetched from a route that requires a principal — a tab that could only
 * ever render an error.
 */

import { useMemo, useState } from "react";
import type { OpenIntent } from "../intent.js";
import { createPreviewClient } from "../preview.js";
import type { WidgetConfig } from "../api.js";
import { de } from "../locale/de.js";
import { useAsync } from "../hooks.js";
import { useBranding } from "../branding.js";
import { CONTENT, MAIN_ASIDE } from "../layout.js";
import { useScrollToTopOnChange } from "../scroll-to-top.js";
import { BrandLogo } from "./BrandLogo.js";
import { CourseList } from "./CourseList.js";
import { StickyMetaBar } from "./CourseHeader.js";
import { OverviewTab } from "./OverviewTab.js";
import { ExpertsTab } from "./ExpertsTab.js";
import { CertificationTab } from "./CertificationTab.js";
import { SignInRequiredDialog } from "./SignInRequiredDialog.js";
import { ErrorNotice, SignedOutNotice, Spinner, TabbedPanel } from "./primitives.js";

/**
 * The three tabs that describe a Fortbildung rather than a learner's place in
 * one. `library` is absent — see this file's header.
 */
const PREVIEW_TABS = ["overview", "speakers", "certification"] as const;
type PreviewTab = (typeof PREVIEW_TABS)[number];

export function PreviewApp(props: WidgetConfig & { signInUrl: string | undefined }) {
  const { apiBase, projectSlug, courseSlug, profileHint, signInUrl } = props;

  const client = useMemo(
    () =>
      createPreviewClient({
        apiBase,
        projectSlug,
        courseSlug,
        ...(profileHint === undefined ? {} : { profileHint }),
      }),
    [apiBase, projectSlug, courseSlug, profileHint],
  );

  /*
   * One small request that answers "may this visitor read anything here?".
   *
   * `perPage: 1` because the answer is the status code and not the page — the
   * catalogue below fetches its own, filtered and paginated, through the same
   * client. Asking is the only way to know: the permission lives on the
   * project row, and the alternative is a host page asserting its own access.
   */
  const access = useAsync(() => client.listCourses({ page: 1, perPage: 1 }), [client]);

  /*
   * The course being read, or the catalogue.
   *
   * Seeded from the element's `course` attribute, which is how MEDICE embed a
   * page dedicated to one Fortbildung. No fragment routing here on purpose:
   * every route the widget encodes is a position *inside* a course — a content,
   * an exam, the Punktemeldung — and a preview reader can be in none of them.
   * The one state they can be in is which course they are reading, and the host
   * page's own URL is what carries that on a per-course embed.
   */
  const [selected, setSelected] = useState<string | undefined>(
    courseSlug === "" ? undefined : courseSlug,
  );

  const [dialogOpen, setDialogOpen] = useState(false);

  // The same rule the signed-in screens follow (DEP-36): opening a course from
  // the catalogue must not land halfway down the new screen.
  useScrollToTopOnChange(selected ?? "");

  if (access.loading && access.data === undefined) {
    return <Spinner label={de.loading} />;
  }

  if (access.data === undefined) {
    /*
     * No preview for this project — or no answer at all.
     *
     * Deliberately not told apart on screen. The 404 the API gives for a
     * project that has not opted in is the same one it gives for a project that
     * does not exist, and a widget that distinguished them would re-introduce
     * the oracle the API refused to be (§9.5).
     */
    return (
      <SignedOutNotice
        title={de.signedOut.title}
        message={de.signedOut.message}
        actionLabel={de.signedOut.action}
        signInUrl={signInUrl}
      />
    );
  }

  const requireSignIn = () => setDialogOpen(true);

  return (
    <div>
      {/*
        The state, stated before it is met.

        §9.4: the visitor is about to read a catalogue they cannot enrol from,
        and finding that out by pressing a button is worse than being told. The
        dialog is then a reminder rather than a surprise.
      */}
      <div className={`${CONTENT} pt-4`}>
        <div className="rounded-md border border-brand-100 bg-brand-50 p-4">
          <p className="text-sm font-semibold text-gray-900">{de.preview.noticeTitle}</p>
          <p className="mt-1 text-sm text-gray-700">{de.preview.noticeMessage}</p>
        </div>
      </div>

      {selected === undefined ? (
        <PreviewCatalogue
          apiBase={apiBase}
          projectSlug={projectSlug}
          client={client}
          onOpen={(slug) => setSelected(slug)}
        />
      ) : (
        <PreviewCourse
          apiBase={apiBase}
          projectSlug={projectSlug}
          client={client}
          courseSlug={selected}
          /*
           * No way back on an embed that named the course itself: there is no
           * catalogue behind it to return to, exactly as on the signed-in
           * screen.
           */
          onBack={courseSlug === "" ? () => setSelected(undefined) : undefined}
          onParticipate={requireSignIn}
        />
      )}

      {dialogOpen ? (
        <SignInRequiredDialog
          signInUrl={signInUrl}
          onDismiss={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** The catalogue, drawn exactly as the signed-in one is. */
function PreviewCatalogue(props: {
  apiBase: string;
  projectSlug: string;
  client: ReturnType<typeof createPreviewClient>;
  onOpen: (slug: string, intent: OpenIntent) => void;
}) {
  const branding = useBranding(props.apiBase, props.projectSlug);

  return (
    <div className="space-y-6">
      {/* The wrapper only when there is a logo — see `Catalogue` in `App.tsx`
          for the 40 px of nothing this guard exists to prevent. */}
      {branding.logoUrl === undefined ? null : (
        <div className="px-4 pt-4">
          <BrandLogo apiBase={props.apiBase} projectSlug={props.projectSlug} />
        </div>
      )}
      <CourseList client={props.client} branding={branding} onOpen={props.onOpen} />
    </div>
  );
}

/** One course's description: the hero, and the three tabs that describe it. */
function PreviewCourse(props: {
  apiBase: string;
  projectSlug: string;
  client: ReturnType<typeof createPreviewClient>;
  courseSlug: string;
  onBack: (() => void) | undefined;
  onParticipate: () => void;
}) {
  const { client, courseSlug } = props;
  const branding = useBranding(props.apiBase, props.projectSlug);
  const [tab, setTab] = useState<PreviewTab>("overview");

  const course = useAsync(() => client.getCourseBySlug(courseSlug), [client, courseSlug]);

  if (course.loading && course.data === undefined) {
    return <Spinner label={de.loading} />;
  }

  if (course.data === undefined) {
    return (
      <div className={`${CONTENT} py-6`}>
        <ErrorNotice
          title={de.error.title}
          message={de.error.noCourse}
          retryLabel={de.error.retry}
          onRetry={course.reload}
        />
      </div>
    );
  }

  const detail = course.data;

  return (
    <div>
      {branding.logoUrl === undefined ? null : (
        <div className={`${CONTENT} mb-6`}>
          <BrandLogo apiBase={props.apiBase} projectSlug={props.projectSlug} />
        </div>
      )}

      {/*
        `status="not_started"` is a fact here, not a placeholder: this reader
        has no account, so there is no enrolment to be in any other state. It is
        what puts **Fortbildung starten** on the button rather than
        "fortsetzen", which would promise a progress record that does not exist.
      */}
      <StickyMetaBar
        course={detail}
        status="not_started"
        onBack={props.onBack}
        onResume={props.onParticipate}
      />

      <div className={`${CONTENT} mt-6`}>
        <TabbedPanel
          tabs={PREVIEW_TABS.map((entry) => ({ id: entry, label: de.tabs[entry] }))}
          active={tab}
          label={detail.title}
          onSelect={setTab}
        >
          <div className={MAIN_ASIDE}>
            <div className="min-w-0 rounded-2xl rounded-tl-none border border-brand-100 bg-white p-5 shadow-sm max-sm:rounded-t-none max-sm:border-t-0 max-sm:border-brand-500 sm:p-6">
              {tab === "overview" ? (
                <OverviewTab course={detail} />
              ) : tab === "speakers" ? (
                <ExpertsTab experts={detail.experts} />
              ) : (
                /*
                 * No `certificate` node: the download exists once a physician
                 * has completed the course, and this reader has not started
                 * one. The tab still belongs here — what the Fortbildung is
                 * worth and who accredited it is the part of the description
                 * somebody weighing whether to sign up most wants.
                 */
                <CertificationTab course={detail} certificate={null} />
              )}
            </div>
          </div>
        </TabbedPanel>
      </div>
    </div>
  );
}
