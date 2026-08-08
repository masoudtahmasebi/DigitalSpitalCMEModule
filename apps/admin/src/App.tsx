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
import { ParticipantAccounts } from "./components/ParticipantAccounts.js";
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

  // `Console` renders the frame itself: the sidebar's contents and the app
  // bar's scope control are both its state, and passing them up only to be
  // passed back down would put the console's navigation in two files (P22-07).
  return (
    <Console
      config={config}
      profile={profile}
      onExpired={() => setProfile(undefined)}
      onSignOut={() => {
        void signOut(config.apiBase).then(() => setProfile(undefined));
      }}
    />
  );
}

/**
 * The console's frame (P22-07).
 *
 * ## Why it changed
 *
 * It was a centred column with a row of text tabs on a white page — the shape a
 * prototype has. Said plainly by the client: *"our admin looks really bad now
 * and that's the place the customers will work with, how can we sell this?"*
 *
 * The layout borrows from **react-admin**, which the client named as the
 * reference: a fixed sidebar for navigation, a slim app bar for identity and
 * scope, content on its own surface. The *ideas*, not the framework — a
 * dependency that size would have to earn its way past ADR-0001, and it would
 * not have prevented one of the bugs this console actually shipped, which were
 * all state.
 *
 * ## What the three regions are for
 *
 * | Sidebar | Where you are in the product. Always visible, so nothing is more than one click away. |
 * | App bar | Whose session this is, and which customer it acts within — the two facts that change what every click does. |
 * | Content | One surface, one width, so a table and a form do not look like two applications. |
 *
 * Signed out, none of it applies: there is nowhere to navigate and no scope to
 * qualify, so the sign-in form gets a narrow centred column and nothing else.
 */
function Shell(props: {
  children: React.ReactNode;
  operator?: string;
  onSignOut?: () => void;
  /** The navigation column. Absent before sign-in, when there is nowhere to go. */
  nav?: React.ReactNode;
  /** Scope controls for the app bar — the customer picker. */
  scope?: React.ReactNode;
}) {
  const signedIn = props.onSignOut !== undefined;

  return (
    <div className="min-h-screen bg-[color:var(--ds-surface)] md:flex">
      {signedIn ? (
        <aside className="shrink-0 bg-[color:var(--ds-ink)] md:min-h-screen md:w-60">
          <div className="flex items-center gap-2.5 px-4 py-4">
            <span
              aria-hidden
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-500 text-xs font-bold text-white"
            >
              DS
            </span>
            <span className="truncate text-sm font-semibold text-white">
              {de.appTitle}
            </span>
          </div>
          {props.nav}
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-2.5">
          {signedIn ? (
            props.scope
          ) : (
            <h1 className="text-base font-semibold text-gray-900">{de.appTitle}</h1>
          )}
          {signedIn ? (
            <div className="flex items-center gap-3">
              {/* Whose session this is. An operator with two accounts — their own
                  and a super admin one — otherwise has no way to tell which they
                  are acting as, and the two differ in what they can destroy. */}
              <span className="text-sm text-gray-600">{props.operator}</span>
              <Button variant="secondary" onClick={() => props.onSignOut?.()}>
                {de.auth.signOut}
              </Button>
            </div>
          ) : null}
        </header>

        <main className="min-w-0 flex-1 p-5">
          <div className={signedIn ? "mx-auto max-w-6xl" : "mx-auto max-w-md pt-12"}>
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * The remembered customer, if the browser still has one.
 *
 * Never trusted as authorisation — it only pre-selects the picker, and the API
 * refuses a customer the operator holds no grant reaching.
 */
function readStored(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
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
  | { kind: "participants" }
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
  /*
   * Ordered by the process, not by when each screen was built.
   *
   * The order somebody actually works in is: a customer exists, it has
   * departments and projects, those hold courses, people are given access to
   * them, they take them, and documents come out at the end. Setup screens
   * (Team, Erscheinungsbild, Sicherheit) come last because they are visited
   * once and then rarely.
   *
   * The previous order put Fortbildungen first and Kunden second-to-last, so an
   * operator setting up a new customer started at step three and had to scroll
   * past four screens to find step one.
   */
  ["customers", de.customers.title, "customer"],
  ["organisation", de.nav.organisation, undefined],
  ["courses", de.nav.courses, undefined],
  // Access before progress: an account has to exist before there is anything
  // to have progress on, and this is the screen that creates one.
  ["participants", de.participantAccounts.title, "learner_record"],
  // Learner records and certificates need `learner_record` / `certificate`,
  // which a department admin and a course editor do not hold: neither has
  // business correcting a physician's name or withdrawing a document.
  ["learners", de.learners.title, "learner_record"],
  ["certificates", de.certificates.title, "certificate"],
  ["staff", de.staff.title, "staff_user"],
  ["branding", de.nav.branding, undefined],
  // No capability: every operator may read the rules their own sign-in is
  // subject to. Which of them they may *change* is enforced on the write —
  // hiding the screen would only hide the platform row from the people it
  // governs (P22-02).
  ["security", de.nav.security, undefined],
];

/**
 * Exported, and its clients injectable, so it can be tested (P22-05).
 *
 * The console shipped four state bugs in a row from a shell with no component
 * tests at all. Constructing the clients inside made that unavoidable: a test
 * could render nothing without a live API. Two optional factories cost nothing
 * in production — the defaults are exactly what was there — and make the shell's
 * behaviour assertable, which is where every one of those bugs lived.
 */
export function Console(props: {
  config: ReturnType<typeof readConfig> & object;
  profile: StaffProfile;
  onExpired: () => void;
  /** Ends the session. Rendered in the app bar by the frame below. */
  onSignOut?: () => void;
  makeAdminClient?: typeof createAdminClient;
  makePlatformClient?: typeof createPlatformClient;
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
  /*
   * Which customer the tenant screens act within, remembered across reloads
   * (P22-08).
   *
   * It was component state, so every reload dropped it and the console landed
   * on "pick a customer" again — which for a super administrator is every
   * reload, and there is no shortage of those while setting a customer up.
   *
   * `localStorage` rather than the URL, for now: the console has no routing,
   * so a URL would be a second navigation model with one thing in it. It is
   * scoped per operator id, so two accounts on one browser do not inherit each
   * other's selection — a super admin and their own customer account are
   * different scopes and switching between them should not carry a customer
   * across.
   *
   * The stored value is *not* trusted: it is offered to the picker, and the
   * API refuses a customer this operator holds no grant reaching. A stale id
   * from a deleted customer simply fails to match and the picker falls back to
   * unchosen.
   */
  const customerKey = `ds.admin.customer.${props.profile.id}`;
  const [customerId, setCustomerId] = useState<string | undefined>(
    () => props.profile.grants[0]?.customerId ?? readStored(customerKey),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (customerId === undefined) window.localStorage.removeItem(customerKey);
      else window.localStorage.setItem(customerKey, customerId);
    } catch {
      // Private browsing, or storage full. Losing the selection on reload is a
      // nuisance; failing to render the console over it would be worse.
    }
  }, [customerId, customerKey]);

  const makeAdmin = props.makeAdminClient ?? createAdminClient;
  const makePlatform = props.makePlatformClient ?? createPlatformClient;

  const client = useMemo(
    () => makeAdmin(props.config, customerId ?? "", props.onExpired),
    [makeAdmin, props.config, customerId, props.onExpired],
  );

  /*
   * A second client, naming no customer at all.
   *
   * The customer registry is above any tenant, and creating the first customer
   * has to work before any exists — the state a fresh installation is in. A
   * client that always named one would 403 the one operator able to fix that.
   */
  const platformClient = useMemo(
    () => makePlatform(props.config, props.onExpired),
    [makePlatform, props.config, props.onExpired],
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
    // No customer chosen, nothing to load. Without this the fetch went out
    // anyway and came back 422 "this route is tenant-scoped and no X-DS-Project
    // header was sent" — correct of the API, and it put the console into its
    // error state before the customer picker had been rendered (P22-03).
    if (customerId === undefined) {
      setCourses([]);
      setProblem(undefined);
      return;
    }

    setProblem(undefined);
    try {
      setCourses(await client.adminListCourses());
    } catch (error) {
      // The API's 403 is the authoritative "you are not an admin".
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.error.generic));
    }
  }, [client, customerId]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  /**
   * Re-read the registry.
   *
   * A callback rather than a bare effect, because creating or deleting a
   * customer has to refresh *this* list too (P22-05). It did not: `Customers`
   * kept a second copy, refreshed that one, and left the picker here empty — so
   * the console said "no customer has been created yet" on every tenant screen
   * while the Kunden table listed the customer just created.
   */
  const loadCustomers = useCallback(async () => {
    if (!props.profile.capabilities.includes("customer")) return;
    try {
      const rows = await platformClient.adminListCustomers();
      setCustomers(rows.map((row) => ({ id: row.id, name: row.name })));
    } catch {
      // Ignored on failure: this list is a convenience, and a console that
      // refused to open because of it would be worse.
    }
  }, [platformClient, props.profile.capabilities]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

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
  /*
   * The customer picker, shown only to an operator who can act in more than one
   * (P22-03), and living in the **app bar** rather than above the content.
   *
   * It is scope, not a filter: it changes what the whole console is pointed at,
   * so it belongs beside the identity it qualifies rather than inside the thing
   * it changes (P22-07). A customer administrator has exactly one customer, on
   * their grant, so they get a label instead of a control with one option.
   */
  const scope =
    props.profile.role !== "super_admin" ? (
      <span className="text-sm font-semibold text-gray-900">
        {customers.find((entry) => entry.id === customerId)?.name ?? de.appTitle}
      </span>
    ) : (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">{de.customerPicker.label}</span>
        <select
          value={customerId ?? ""}
          onChange={(event) => setCustomerId(event.target.value || undefined)}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 shadow-sm"
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

  /*
   * The navigation column.
   *
   * A sidebar rather than a row of tabs — react-admin's shape, and the right one
   * here for two reasons. There are eight destinations and the list grows with
   * every feature, and a tab row that wraps onto a second line stops reading as
   * navigation at all. And the content is mostly tables, which want the
   * horizontal space a vertical nav leaves them.
   */
  const nav = (
    <nav className="px-2 pb-4">
      {SECTIONS.filter(
        ([, , capability]) =>
          capability === undefined || props.profile.capabilities.includes(capability),
      ).map(([value, label]) => {
        const active = view.kind === value;
        return (
          <button
            key={value}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => setView({ kind: value } as View)}
            className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors ${
              active
                ? "bg-brand-500 text-white"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );

  /** The frame every screen renders inside. */
  const frame = (body: React.ReactNode) => (
    <Shell
      nav={nav}
      scope={scope}
      operator={props.profile.displayName}
      // Always present in the console — it is what tells the frame it is signed
      // in. The prop is optional only so a test can render without one.
      onSignOut={props.onSignOut ?? (() => undefined)}
    >
      {body}
    </Shell>
  );

  if (forbidden) {
    return (
      <Notice tone="error" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  /*
   * The navigation renders above the failure, not instead of it.
   *
   * These were bare returns that replaced the whole screen. That is how a 422
   * from `/admin/courses` — correct, and caused by no customer having been
   * chosen — came to hide the customer picker: the one control that could clear
   * the error was behind the error, and the only way out was signing out. A
   * console recoverable only by signing out is not recoverable.
   */
  if (problem !== undefined) {
    return frame(
      <>
        <div className="space-y-3">
          <Notice tone="error" title={de.error.title}>
            {problem}
          </Notice>
          <Button variant="secondary" onClick={() => void loadCourses()}>
            {de.error.retry}
          </Button>
        </div>
      </>,
    );
  }

  if (courses === undefined) {
    return frame(
      <>
        <Spinner label={de.loading} />
      </>,
    );
  }

  /*
   * The course editor renders **inside** the frame like everything else
   * (P22-09).
   *
   * These two returned bare, above the point where the frame is built, so the
   * course editor and the new-course form drew with no sidebar and no app bar
   * — the content ran to the left edge of the window and the operator lost
   * every navigation target at once. Reported as "the Fortbildung page comes
   * out of the layout", which is exactly what it was.
   *
   * The cause is worth naming because it is structural rather than a typo: the
   * frame was assembled halfway down a long component, so *every* return above
   * that line silently escaped it and nothing made that visible. Returning
   * through one `frame()` is what makes the layout a property of the component
   * rather than of where a branch happens to sit.
   */
  if (view.kind === "course") {
    return frame(
      <CourseScreen
        client={client}
        slug={view.slug}
        tab={view.tab}
        onTab={(tab) => setView({ kind: "course", slug: view.slug, tab })}
        onBack={() => {
          setView({ kind: "courses" });
          void loadCourses();
        }}
      />,
    );
  }

  if (view.kind === "new-course") {
    return frame(
      <NewCourseScreen
        client={client}
        onCreated={(slug) => {
          void loadCourses();
          setView({ kind: "course", slug, tab: "structure" });
        }}
        onCancel={() => setView({ kind: "courses" })}
      />,
    );
  }

  // A tenant screen with no customer chosen has nothing to act within. Saying
  // so beats an empty list, which reads as a customer with no content, and
  // beats a wall of 422s from an API that is answering correctly.
  if (customerId === undefined && TENANT_VIEWS.has(view.kind)) {
    return frame(
      <>
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {customers.length === 0 ? de.customerPicker.noneYet : de.customerPicker.none}
        </p>
      </>,
    );
  }

  if (view.kind === "participants") {
    return frame(<ParticipantAccounts client={client} />);
  }

  if (view.kind === "learners") {
    return frame(
      <>
        <Learners client={client} />
      </>,
    );
  }

  if (view.kind === "certificates") {
    return frame(
      <>
        <Certificates client={client} />
      </>,
    );
  }

  if (view.kind === "staff") {
    return frame(
      <>
        {/* The platform client: operator accounts sit above any tenant, so the
            request must not carry `X-DS-Project`. */}
        <StaffAccounts
          client={platformClient}
          customerId={props.profile.grants[0]?.customerId ?? null}
          customers={customers}
        />
      </>,
    );
  }

  if (view.kind === "security") {
    return frame(
      <>
        {/* Above any tenant, like the customer registry: no `X-DS-Project`. */}
        <Security
          client={platformClient}
          isSuperAdmin={props.profile.role === "super_admin"}
          ownSecondFactorEnrolled={props.profile.secondFactorEnrolled}
          customers={customers}
        />
      </>,
    );
  }

  if (view.kind === "customers") {
    return frame(
      <>
        {/* The platform client: no `X-DS-Project` header, because this list
            spans customers and has to work before any project exists. */}
        <Customers
          client={platformClient}
          onChanged={() => {
            void loadCustomers();
          }}
        />
      </>,
    );
  }

  if (view.kind === "branding") {
    return frame(
      <>
        {/* A department_admin gets a 403 from the PUT; the screen renders for
            them because the API, not the navigation, is the gate (P9-01). */}
        <BrandingSettings client={client} />
      </>,
    );
  }

  if (view.kind === "organisation") {
    return frame(
      <>
        <Organisation client={client} />
      </>,
    );
  }

  return frame(
    <section className="space-y-4">
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
    </section>,
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
