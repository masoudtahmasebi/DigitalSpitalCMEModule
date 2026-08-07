/**
 * The admin console shell (P9-01, re-authenticated in P12-06).
 *
 * ## Navigation shows only what the role may reach — and that is not the gate
 *
 * A `department_admin` sees no edit form because the console does not render
 * one for them. That is a courtesy. The refusal lives in the API, which 403s
 * `PATCH /admin/courses/{slug}` for anyone below `customer_admin` regardless of
 * what the client chose to draw. Any screen here could be reached by typing a
 * URL, and none of them would work.
 *
 * The console does not read roles out of a token, and deliberately does not
 * try. Since ADR-0012 it does not have one: the session is an httpOnly cookie
 * no script here can read, and the profile — including `capabilities` — comes
 * from `/admin/auth/session`, which is the server's answer rather than the
 * page's guess. That is what decides which sections are drawn; the API decides
 * which ones work.
 *
 * ## Why the staff plane and not Keycloak
 *
 * The console is DigitalSpital's own tool and its operators are DigitalSpital's
 * own people. Authenticating them against a customer's realm meant that
 * customer's realm administrators could mint platform super administrators, and
 * that one missing audience mapper in one customer's client took the console
 * down along with every learner. Learners stay federated; operators do not.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminCourseDetail,
  AdminCourseSummary,
  ApiClient,
  ParticipantList,
  ProjectSummary,
} from "@ds/sdk";
import { readConfig } from "./config.js";
import { currentStaff, signOut, type StaffProfile } from "./staff-auth.js";
import {
  createAdminClient,
  createPlatformClient,
  describeError,
  isForbidden,
} from "./api.js";
import { de } from "./locale/de.js";
import { Badge, Button, Notice, Spinner, Table } from "./components/ui.js";
import { BrandingSettings } from "./components/BrandingSettings.js";
import { CourseSettings } from "./components/CourseSettings.js";
import { CoursePresentation } from "./components/CoursePresentation.js";
import { Participants } from "./components/Participants.js";
import { Organisation } from "./components/Organisation.js";
import { NewCourse } from "./components/NewCourse.js";
import { CourseStructureEditor } from "./components/CourseStructure.js";
import { QuizEditor } from "./components/QuizEditor.js";
import { EvaluationEditor } from "./components/EvaluationEditor.js";
import { ExpertsEditor } from "./components/ExpertsEditor.js";
import { Customers } from "./components/Customers.js";
import { Learners } from "./components/Learners.js";
import { Certificates } from "./components/Certificates.js";
import { StaffAccounts } from "./components/StaffAccounts.js";
import { Security } from "./components/Security.js";
import { SignIn } from "./components/SignIn.js";

export function App() {
  const config = useMemo(() => readConfig(), []);
  const [profile, setProfile] = useState<StaffProfile | undefined>();
  const [checking, setChecking] = useState(true);

  /*
   * Ask the API who is signed in.
   *
   * The console cannot tell from the cookie — it is httpOnly, which is the
   * point — so this is not an optimisation over reading local state, it is the
   * only way to answer the question. It also survives a reload, which a token
   * held in memory would not.
   */
  useEffect(() => {
    if (config === undefined) return;

    let cancelled = false;
    currentStaff(config.apiBase)
      .then((found) => {
        if (cancelled) return;
        setProfile(found);
        setChecking(false);
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config]);

  if (config === undefined) {
    return (
      <Shell>
        <Notice tone="error" title={de.error.title}>
          {de.error.misconfigured}
        </Notice>
      </Shell>
    );
  }

  if (checking) {
    return (
      <Shell>
        <Spinner label={de.auth.signingIn} />
      </Shell>
    );
  }

  if (profile === undefined) {
    return (
      <Shell>
        <SignIn apiBase={config.apiBase} onSignedIn={setProfile} />
      </Shell>
    );
  }

  return (
    <Shell
      operator={profile.displayName}
      onSignOut={() => {
        void signOut(config.apiBase).then(() => setProfile(undefined));
      }}
    >
      <Console
        config={config}
        profile={profile}
        onExpired={() => setProfile(undefined)}
      />
    </Shell>
  );
}

function Shell(props: {
  children: React.ReactNode;
  operator?: string;
  onSignOut?: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <h1 className="text-lg font-bold text-gray-900">{de.appTitle}</h1>
        {props.onSignOut === undefined ? null : (
          <div className="flex items-center gap-3">
            {/* Whose session this is. An operator with two accounts — their own
                and a super admin one — otherwise has no way to tell which they
                are acting as, and the two differ in what they can destroy. */}
            <span className="text-sm text-gray-600">{props.operator}</span>
            <Button variant="secondary" onClick={props.onSignOut}>
              {de.auth.signOut}
            </Button>
          </div>
        )}
      </header>
      {props.children}
    </div>
  );
}

/**
 * Which course tab is open.
 *
 * `structure` is where a course is actually built, so it is the tab a newly
 * created course lands on — settings would open on a form asking for a VNR
 * before there is anything to accredit.
 */
type CourseTab =
  "settings" | "presentation" | "structure" | "experts" | "evaluation" | "participants";

const COURSE_TABS: ReadonlyArray<readonly [CourseTab, string]> = [
  ["structure", de.structure.title],
  // Before `settings`: editing a title is the routine act, and the settings tab
  // holds the controls that can void an accreditation.
  ["presentation", de.course.presentation],
  ["settings", de.course.settings],
  ["experts", de.experts.title],
  ["evaluation", de.evaluation.title],
  ["participants", de.participants.title],
];

type View =
  | { kind: "courses" }
  | { kind: "new-course" }
  | { kind: "organisation" }
  | { kind: "branding" }
  | { kind: "customers" }
  | { kind: "learners" }
  | { kind: "certificates" }
  | { kind: "staff" }
  | { kind: "security" }
  | { kind: "course"; slug: string; tab: CourseTab };

/**
 * The sections, and the capability each one needs.
 *
 * `undefined` means every operator. `customer` is held only by `super_admin`
 * (P12-01b) — a customer is the tenant boundary itself, so nobody inside one
 * may see or mint another.
 *
 * This hides a tab; it does not protect anything. The API 403s the endpoints
 * behind it regardless of what was drawn, and `Customers` handles that 403
 * because a URL can be typed.
 */
const SECTIONS: ReadonlyArray<readonly [View["kind"], string, string | undefined]> = [
  ["courses", de.nav.courses, undefined],
  ["organisation", de.nav.organisation, undefined],
  ["branding", de.nav.branding, undefined],
  // Learner records and certificates need `learner_record` / `certificate`,
  // which a department admin and a course editor do not hold: neither has
  // business correcting a physician's name or withdrawing a document.
  ["learners", de.learners.title, "learner_record"],
  ["certificates", de.certificates.title, "certificate"],
  ["staff", de.staff.title, "staff_user"],
  ["customers", de.customers.title, "customer"],
  // No capability: every operator may read the rules their own sign-in is
  // subject to. Which of them they may *change* is enforced on the write —
  // hiding the screen would only hide the platform row from the people it
  // governs (P22-02).
  ["security", de.nav.security, undefined],
];

function Console(props: {
  config: ReturnType<typeof readConfig> & object;
  profile: StaffProfile;
  onExpired: () => void;
}) {
  /*
   * Which customer the tenant screens act within (P22-03).
   *
   * A customer administrator has exactly one and it is on their grant, so there
   * is nothing to choose. A super administrator belongs to none, and picks —
   * the picker is populated from the registry below, and until they have picked
   * the tenant screens have no customer to act in and say so.
   *
   * This used to be `ADMIN_DEFAULT_PROJECT_SLUG`, one project named by the
   * deployment for the whole console. That is why a super admin could not reach
   * a second customer, and why a fresh installation — where that project does
   * not exist yet — met a 404 on every tenant screen while the platform screens
   * worked.
   */
  const [customerId, setCustomerId] = useState<string | undefined>(
    () => props.profile.grants[0]?.customerId ?? undefined,
  );

  const client = useMemo(
    () => createAdminClient(props.config, customerId ?? "", props.onExpired),
    [props.config, customerId, props.onExpired],
  );

  /*
   * A second client, naming no customer at all.
   *
   * The customer registry is above any tenant, and creating the first customer
   * has to work before any exists — the state a fresh installation is in. A
   * client that always named one would 403 the one operator able to fix that.
   */
  const platformClient = useMemo(
    () => createPlatformClient(props.config, props.onExpired),
    [props.config, props.onExpired],
  );

  const [view, setView] = useState<View>({ kind: "courses" });

  /**
   * Which views need a customer to act within.
   *
   * `customers`, `staff` and `security` are above any tenant and work with none
   * — which is what makes a fresh installation recoverable: the operator can
   * create the first customer from a console that has none.
   */
  const TENANT_VIEWS: ReadonlySet<View["kind"]> = new Set([
    "courses",
    "course",
    "organisation",
    "branding",
    "learners",
    "certificates",
  ]);

  /*
   * The customer registry, for the one place the console needs it beyond the
   * Kunden screen: a super admin inviting a customer-scoped operator has to
   * say which customer, and they belong to none themselves.
   *
   * Only fetched for an operator who holds the capability — everybody else
   * gets a 403, and an invitation they send is scoped to their own customer
   * anyway, so there is nothing to choose.
   */
  const [customers, setCustomers] = useState<readonly { id: string; name: string }[]>([]);
  const [courses, setCourses] = useState<AdminCourseSummary[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);

  const loadCourses = useCallback(async () => {
    setProblem(undefined);
    try {
      setCourses(await client.adminListCourses());
    } catch (error) {
      // The API's 403 is the authoritative "you are not an admin".
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.error.generic));
    }
  }, [client]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    if (!props.profile.capabilities.includes("customer")) return;
    platformClient
      .adminListCustomers()
      // Ignored on failure: this list is a convenience on one form, and a
      // console that refused to open because of it would be worse.
      .then((rows) => setCustomers(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => undefined);
  }, [platformClient, props.profile.capabilities]);

  if (forbidden) {
    return (
      <Notice tone="error" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  if (problem !== undefined) {
    return (
      <div className="space-y-3">
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
        <Button variant="secondary" onClick={() => void loadCourses()}>
          {de.error.retry}
        </Button>
      </div>
    );
  }

  if (courses === undefined) return <Spinner label={de.loading} />;

  if (view.kind === "course") {
    return (
      <CourseScreen
        client={client}
        slug={view.slug}
        tab={view.tab}
        onTab={(tab) => setView({ kind: "course", slug: view.slug, tab })}
        onBack={() => {
          setView({ kind: "courses" });
          void loadCourses();
        }}
      />
    );
  }

  if (view.kind === "new-course") {
    return (
      <NewCourseScreen
        client={client}
        onCreated={(slug) => {
          void loadCourses();
          setView({ kind: "course", slug, tab: "structure" });
        }}
        onCancel={() => setView({ kind: "courses" })}
      />
    );
  }

  // Top-level sections. Branding and organisation are project-wide rather than
  // per course — a typeface and an identity-provider binding are properties of
  // the customer, not of one Fortbildung — so they sit beside the course list
  // rather than inside a course. Kunden sits above all of them and appears only
  // for an operator who holds the capability.
  /*
   * The customer picker, shown only to an operator who can act in more than one
   * (P22-03).
   *
   * A customer administrator has exactly one, on their grant, so a picker would
   * be a control with a single option — a click nobody should have to make. A
   * super administrator belongs to none and must choose.
   */
  const picker =
    props.profile.role !== "super_admin" ? null : (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-600">{de.customerPicker.label}</span>
        <select
          value={customerId ?? ""}
          onChange={(event) => setCustomerId(event.target.value || undefined)}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="">{de.customerPicker.choose}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
      </label>
    );

  const sections = (
    <>
      {picker === null ? null : <div className="pb-2">{picker}</div>}
      <nav className="flex gap-1 border-b border-gray-200">
        {SECTIONS.filter(
          ([, , capability]) =>
            capability === undefined || props.profile.capabilities.includes(capability),
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={view.kind === value ? "page" : undefined}
            onClick={() => setView({ kind: value } as View)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              view.kind === value
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
    </>
  );

  // A tenant screen with no customer chosen has nothing to act within. Saying
  // so beats an empty list, which reads as a customer with no content, and
  // beats a wall of 422s from an API that is answering correctly.
  if (customerId === undefined && TENANT_VIEWS.has(view.kind)) {
    return (
      <div className="space-y-5">
        {sections}
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {customers.length === 0 ? de.customerPicker.noneYet : de.customerPicker.none}
        </p>
      </div>
    );
  }

  if (view.kind === "learners") {
    return (
      <div className="space-y-5">
        {sections}
        <Learners client={client} />
      </div>
    );
  }

  if (view.kind === "certificates") {
    return (
      <div className="space-y-5">
        {sections}
        <Certificates client={client} />
      </div>
    );
  }

  if (view.kind === "staff") {
    return (
      <div className="space-y-5">
        {sections}
        {/* The platform client: operator accounts sit above any tenant, so the
            request must not carry `X-DS-Project`. */}
        <StaffAccounts
          client={platformClient}
          customerId={props.profile.grants[0]?.customerId ?? null}
          customers={customers}
        />
      </div>
    );
  }

  if (view.kind === "security") {
    return (
      <div className="space-y-5">
        {sections}
        {/* Above any tenant, like the customer registry: no `X-DS-Project`. */}
        <Security
          client={platformClient}
          isSuperAdmin={props.profile.role === "super_admin"}
          ownSecondFactorEnrolled={props.profile.secondFactorEnrolled}
          customers={customers}
        />
      </div>
    );
  }

  if (view.kind === "customers") {
    return (
      <div className="space-y-5">
        {sections}
        {/* The platform client: no `X-DS-Project` header, because this list
            spans customers and has to work before any project exists. */}
        <Customers client={platformClient} />
      </div>
    );
  }

  if (view.kind === "branding") {
    return (
      <div className="space-y-5">
        {sections}
        {/* A department_admin gets a 403 from the PUT; the screen renders for
            them because the API, not the navigation, is the gate (P9-01). */}
        <BrandingSettings client={client} />
      </div>
    );
  }

  if (view.kind === "organisation") {
    return (
      <div className="space-y-5">
        {sections}
        <Organisation client={client} />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      {sections}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-gray-900">{de.courses.title}</h2>
        <Button onClick={() => setView({ kind: "new-course" })}>
          {de.newCourse.action}
        </Button>
      </div>

      {courses.length === 0 ? (
        <p className="text-sm text-gray-600">{de.courses.empty}</p>
      ) : (
        <Table
          headers={[
            de.courses.columnTitle,
            de.courses.columnVnr,
            de.courses.columnPoints,
            de.courses.columnParticipants,
            de.courses.columnCertificate,
          ]}
        >
          {courses.map((course) => (
            <tr key={course.slug} className="border-b border-gray-100">
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="font-medium text-brand-700 underline"
                  onClick={() =>
                    setView({ kind: "course", slug: course.slug, tab: "structure" })
                  }
                >
                  {course.title}
                </button>
              </td>
              <td className="px-3 py-2 text-gray-600">{course.vnr ?? "—"}</td>
              <td className="px-3 py-2">
                {course.cmePoints === null
                  ? "—"
                  : `${course.cmePoints} (${course.cmeCategory ?? "?"})`}
              </td>
              <td className="px-3 py-2 text-gray-700">
                {de.courses.completedOf(course.completedCount, course.enrolmentCount)}
              </td>
              <td className="px-3 py-2">
                <Badge tone={course.certificateReady ? "ok" : "warn"}>
                  {course.certificateReady
                    ? de.courses.certificateReady
                    : de.courses.certificateNotReady}
                </Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

/**
 * Creating a course needs the project list, and only this screen needs it.
 *
 * Fetched here rather than alongside the course list so opening the console
 * costs one request, not two — an admin who never creates a course never asks
 * for it.
 */
function NewCourseScreen(props: {
  client: ApiClient;
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const { client } = props;

  useEffect(() => {
    client.adminListProjects().then(setProjects, (error: unknown) => {
      setProblem(describeError(error, de.error.generic));
    });
  }, [client]);

  if (problem !== undefined) {
    return (
      <Notice tone="error" title={de.error.title}>
        {problem}
      </Notice>
    );
  }

  if (projects === undefined) return <Spinner label={de.loading} />;

  return (
    <NewCourse
      client={client}
      projects={projects}
      onCreated={props.onCreated}
      onCancel={props.onCancel}
    />
  );
}

function CourseScreen(props: {
  client: ApiClient;
  slug: string;
  tab: CourseTab;
  onTab: (tab: CourseTab) => void;
  onBack: () => void;
}) {
  const [course, setCourse] = useState<AdminCourseDetail | undefined>();
  const [participants, setParticipants] = useState<ParticipantList | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  /**
   * Editing one quiz replaces the structure tab rather than opening beside it.
   *
   * A quiz belongs to a content item, which belongs to a chapter — so it is a
   * level deeper than the tabs, and giving it a tab of its own would mean a tab
   * that is meaningless until something in another tab is selected.
   */
  const [quiz, setQuiz] = useState<{ contentId: string; title: string } | undefined>();

  const { client, slug, tab } = props;

  useEffect(() => {
    setProblem(undefined);
    client.adminGetCourse(slug).then(setCourse, (error: unknown) => {
      setProblem(describeError(error, de.error.generic));
    });
  }, [client, slug]);

  useEffect(() => {
    if (tab !== "participants") return;
    client.adminListParticipants(slug).then(setParticipants, (error: unknown) => {
      setProblem(describeError(error, de.error.generic));
    });
  }, [client, slug, tab]);

  // Leaving the structure tab abandons a quiz that was open under it.
  useEffect(() => {
    if (tab !== "structure") setQuiz(undefined);
  }, [tab]);

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={props.onBack}>
          {de.nav.back}
        </Button>
        <h2 className="text-base font-semibold text-gray-900">
          {course?.title ?? props.slug}
        </h2>
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200">
        {COURSE_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? "page" : undefined}
            onClick={() => props.onTab(value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === value
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-600"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      <CourseTabContent
        client={client}
        slug={slug}
        tab={tab}
        course={course}
        participants={participants}
        quiz={quiz}
        onEditQuiz={(contentId, title) => setQuiz({ contentId, title })}
        onCloseQuiz={() => setQuiz(undefined)}
        onCourseSaved={setCourse}
      />
    </section>
  );
}

function CourseTabContent(props: {
  client: ApiClient;
  slug: string;
  tab: CourseTab;
  course: AdminCourseDetail | undefined;
  participants: ParticipantList | undefined;
  quiz: { contentId: string; title: string } | undefined;
  onEditQuiz: (contentId: string, title: string) => void;
  onCloseQuiz: () => void;
  onCourseSaved: (course: AdminCourseDetail) => void;
}) {
  const { client, slug } = props;

  switch (props.tab) {
    case "structure":
      return props.quiz === undefined ? (
        <CourseStructureEditor
          client={client}
          courseSlug={slug}
          onEditQuiz={props.onEditQuiz}
        />
      ) : (
        <QuizEditor
          client={client}
          contentId={props.quiz.contentId}
          contentTitle={props.quiz.title}
          onBack={props.onCloseQuiz}
        />
      );

    case "experts":
      return <ExpertsEditor client={client} courseSlug={slug} />;

    case "evaluation":
      return <EvaluationEditor client={client} courseSlug={slug} />;

    case "presentation":
      return props.course === undefined ? (
        <Spinner label={de.loading} />
      ) : (
        <CoursePresentation
          client={client}
          course={props.course}
          onSaved={props.onCourseSaved}
        />
      );

    case "settings":
      return props.course === undefined ? (
        <Spinner label={de.loading} />
      ) : (
        <CourseSettings
          client={client}
          course={props.course}
          onSaved={props.onCourseSaved}
        />
      );

    case "participants":
      return props.participants === undefined ? (
        <Spinner label={de.loading} />
      ) : (
        <Participants client={client} courseSlug={slug} list={props.participants} />
      );
  }
}
