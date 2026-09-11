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

import { courseAvailability, formatBerlinDate } from "@ds/domain";
import { ToastProvider } from "./toasts.js";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  toastPublisher,
} from "./api.js";
import { de } from "./locale/de.js";
import { Badge, Button, ConfirmButton, Notice, Spinner, Table } from "./components/ui.js";
import { EmptyState, Page, type Crumb } from "./components/page.js";
import { CopySettings } from "./components/CopySettings.js";
import { MediaLibrary } from "./components/MediaLibrary.js";
import { PlatformEiv } from "./components/PlatformEiv.js";
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
import { EivQueue } from "./components/EivQueue.js";
import { StaffAccounts } from "./components/StaffAccounts.js";
import { Security } from "./components/Security.js";
import { SignIn } from "./components/SignIn.js";
import { forgetHash, NewPassword, tokenFromHash } from "./components/NewPassword.js";
import { decode, encode, type Route, type RouteCourseTab } from "./routes.js";
import { Shell } from "./components/shell/Shell.js";
import { Sidebar } from "./components/shell/Sidebar.js";
import { sectionFor, visibleNav } from "./components/shell/navigation.js";

export function App() {
  const config = useMemo(() => readConfig(), []);
  const [profile, setProfile] = useState<StaffProfile | undefined>();
  const [checking, setChecking] = useState(true);

  /*
   * The token out of `#passwort-neu?token=…`, read exactly once (P40-02).
   *
   * The initialiser runs on the first render and clears the fragment in the
   * same breath, so the address bar stops carrying a live credential the
   * moment the page has it. `useState`'s lazy form rather than an effect,
   * because an effect runs *after* the first paint — and the first paint would
   * be the sign-in form, which then flips to this screen.
   */
  const [resetToken, setResetToken] = useState<string | undefined>(() => {
    const token = tokenFromHash(
      typeof window === "undefined" ? "" : window.location.hash,
    );
    if (token !== undefined) forgetHash();
    return token;
  });

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
      <Shell apiBase={config.apiBase}>
        <Spinner label={de.auth.signingIn} />
      </Shell>
    );
  }

  /*
   * A reset or invitation link beats everything else on the page (P40-02).
   *
   * Checked before the signed-out branch and before the signed-*in* one: an
   * operator who followed a reset link while still holding a session is
   * somebody who thinks their account is compromised, and dropping them into
   * the console they are already signed in to would be the wrong answer to
   * that.
   *
   * Read once into state rather than off `window` on every render, and erased
   * from the address bar at the same moment — so a reload does not carry the
   * token and a bookmark cannot preserve it.
   */
  /*
   * Every branch below is wrapped in `withToasts` (P205-02).
   *
   * The client asked the right question — *"shouldn't the toast and error
   * handling be a general thing that the layout has?"* — and the answer was no,
   * it was not. `ToastProvider` sat on the signed-in branch alone, so the
   * sign-in form and the password-reset screen had no host at all: a failure
   * raised there reached the default no-op publisher and vanished. Those are
   * the two screens where a failure is most likely, which is the shape §9.1
   * keeps naming — a net with a hole exactly where things fall.
   */
  if (resetToken !== undefined) {
    return withToasts(
      <Shell apiBase={config.apiBase}>
        <NewPassword
          apiBase={config.apiBase}
          token={resetToken}
          onDone={() => setResetToken(undefined)}
        />
      </Shell>,
    );
  }

  if (profile === undefined) {
    return withToasts(
      <Shell apiBase={config.apiBase}>
        <SignIn apiBase={config.apiBase} onSignedIn={setProfile} />
      </Shell>,
    );
  }

  // `Console` renders the frame itself: the sidebar's contents and the app
  // bar's scope control are both its state, and passing them up only to be
  // passed back down would put the console's navigation in two files (P22-07).
  return withToasts(
    <Console
      config={config}
      profile={profile}
      onExpired={() => setProfile(undefined)}
      onSignOut={() => {
        void signOut(config.apiBase).then(() => setProfile(undefined));
      }}
    />,
  );
}

/**
 * The toast host, around whatever the console is currently showing (P205-02).
 *
 * A function rather than a component wrapping `App`'s body, because `App`
 * returns from three places and the point is that **none of them can be the
 * one that forgets**. Written as a wrapper each branch calls, it is one word at
 * each return and impossible to half-apply.
 *
 * Outside `Shell` rather than inside: a failure raised while a screen unmounts
 * still needs somewhere to go, and the host must outlive the screen.
 *
 * ## What this deliberately does not reach
 *
 * The sign-in and password-reset screens now *have* a host, but their own calls
 * go through `staff-auth.ts` rather than the wrapped SDK client, so the net in
 * `api.ts` does not announce them — and must not. `requestPasswordReset`
 * answers identically for an unknown address, a disabled account and a
 * successful send (§9.5, P40): a toast that distinguished them would hand an
 * enumeration oracle to anyone with a login form.
 */
function withToasts(children: ReactNode): ReactNode {
  return <ToastProvider publishRef={toastPublisher}>{children}</ToastProvider>;
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
/**
 * Why a course is, or is not, reaching learners (P201-01).
 *
 * ## Why this cell exists
 *
 * The client created a course, could not find it in the Fortbildungsbereich,
 * and asked what was going on. My first answer was "it is a draft" and it was
 * **wrong** — they sent back a screenshot of the course published. Guessing at
 * which of the reasons applies is worth nothing; the row saying which one is
 * worth having every time somebody asks.
 *
 * The screen already carried the rule in its intro — *"until it is published it
 * is a draft and participants cannot see it"* — and never applied it to a row.
 * §9.4: state the rule where the person is looking at the thing it decides.
 *
 * ## The rule is `courseAvailability`, not a copy of it
 *
 * The catalogue's SQL narrows on `status`, `validFrom` and `validTo`, and
 * `catalog.service.ts` applies `courseAvailability` to what comes back. This
 * cell asks the **same domain function** rather than re-deriving the three
 * comparisons, so the console cannot develop its own opinion about who can see
 * what (§4 invariant 6).
 *
 * ## The fifth reason, which is not availability at all
 *
 * A published, in-window course still does not appear where somebody is looking
 * if it is not `on_demand`: the catalogue splits On Demand from Live and
 * Präsenz into two tabs. That is not a defect and not something
 * `courseAvailability` knows about, so it is said separately.
 */
function VisibilityCell(props: {
  course: {
    status: string;
    validFrom: string | null;
    validTo: string | null;
    deliveryType: string;
  };
  now: Date;
}) {
  const { course } = props;
  const state = courseAvailability(
    {
      status: course.status === "published" ? "published" : "draft",
      validFrom: course.validFrom === null ? null : new Date(course.validFrom),
      validTo: course.validTo === null ? null : new Date(course.validTo),
    },
    props.now,
  );

  if (state === "draft") {
    return (
      <>
        <Badge tone="muted">{de.courses.visibleDraft}</Badge>
        <p className="mt-1 text-xs text-gray-500">{de.courses.visibleDraftWhy}</p>
      </>
    );
  }

  if (state === "not_yet") {
    return (
      <Badge tone="warn">
        {de.courses.visibleNotYet(
          formatBerlinDate(new Date(course.validFrom ?? Date.now())),
        )}
      </Badge>
    );
  }

  if (state === "ended") {
    return (
      <Badge tone="warn">
        {de.courses.visibleEnded(
          formatBerlinDate(new Date(course.validTo ?? Date.now())),
        )}
      </Badge>
    );
  }

  return (
    <>
      <Badge tone="ok">{de.courses.visibleNow}</Badge>
      {course.deliveryType === "on_demand" ? null : (
        <p className="mt-1 text-xs text-gray-500">{de.courses.visibleOtherTab}</p>
      )}
    </>
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
/** Likewise — `routes.ts` declares it, this file uses it. */
type CourseTab = RouteCourseTab;

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

/**
 * The screen the console is on.
 *
 * An alias, not a copy. This union was written out here *and* in `routes.ts`,
 * where its own header said "Mirrors the `CourseTab` union in `App.tsx`" — two
 * homes for one value, which §9.10b is about. Adding a screen meant editing
 * both, and nothing would have failed if you edited one.
 *
 * `Route` is the home, because that is the file the address bar is parsed in
 * and an unrepresentable route is the one that actually breaks something.
 */
type View = Route;

/**
 * Exported, and its clients injectable, so it can be tested (P22-05).
 *
 * The console shipped four state bugs in a row from a shell with no component
 * tests at all. Constructing the clients inside made that unavoidable: a test
 * could render nothing without a live API. Two optional factories cost nothing
 * in production — the defaults are exactly what was there — and make the shell's
 * behaviour assertable, which is where every one of those bugs lived.
 */

/**
 * The panel a tenant screen shows when no customer is chosen (P127-01).
 *
 * The previous version was one amber sentence — *"Bitte wählen Sie oben einen
 * Kunden aus"* — which is true and leaves the operator to find the control it
 * refers to. §9.4: where an action is impossible, say why **at the point
 * somebody looks for it**, and give them the next step rather than directions
 * to it.
 *
 * So the two ways forward are the two controls. Which of them appears depends on
 * the account: an operator without the `customer` capability cannot create one,
 * and offering it would be a button that can only refuse (§9.2).
 */
function ChooseCustomerPrompt(props: {
  customers: readonly { readonly id: string; readonly name: string }[];
  canCreate: boolean;
  onChoose: (id: string) => void;
  onCreate: () => void;
}) {
  const { customers, canCreate } = props;

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">
        {de.customerPicker.promptTitle}
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        {customers.length === 0
          ? de.customerPicker.promptEmptyBody
          : de.customerPicker.promptBody}
      </p>

      {/*
        One button per customer, not a second dropdown.

        The shell already carries a customer picker in its header, and a
        `<select>` here would be the same control twice on one screen — two
        places to do one thing, which is how they end up disagreeing about which
        is authoritative. It also broke fifteen tests that reasonably assumed
        there is one combobox in the console. Buttons make the choice one click
        rather than open-then-pick, on the screen whose whole purpose is that
        choice.
      */}
      {customers.length === 0 ? null : (
        <ul className="mt-5 space-y-2">
          {customers.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => props.onChoose(customer.id)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-left text-sm font-medium text-gray-900 shadow-sm transition-colors hover:border-brand-500 hover:bg-brand-50"
              >
                {customer.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <div className="mt-5">
          <Button variant="primary" onClick={props.onCreate}>
            {de.customerPicker.promptCreate}
          </Button>
        </div>
      ) : customers.length === 0 ? (
        /*
         * Nothing exists and this operator cannot create one. Saying so is the
         * honest end of the road — the alternative is a screen that looks
         * broken to somebody who has done nothing wrong (§9.10).
         */
        <p className="mt-5 text-sm text-gray-600">{de.customerPicker.promptNoRights}</p>
      ) : null}
    </div>
  );
}

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

  /*
   * The screen, kept in the address bar (P42-01).
   *
   * `view` used to be plain state, so every screen shared one URL: back left
   * the console, reload lost your place, and no screen could be linked to.
   *
   * `setView` still looks like `useState`'s setter to every call site — there
   * are twenty of them — and additionally pushes a history entry, which is what
   * makes the browser's back button mean "the screen before" rather than "the
   * page before this app".
   */
  const [view, setViewState] = useState<View>(
    () =>
      (decode(typeof window === "undefined" ? "" : window.location.hash) as
        View | undefined) ?? { kind: "courses" },
  );

  const setView = useCallback((next: View) => {
    setViewState(next);
    if (typeof window !== "undefined") {
      const target = encode(next as Route);
      // Guarded: `setView` is called on some paths that are already at the
      // route (a tab re-selected, a list refreshed), and pushing a duplicate
      // entry would make the back button need two presses to do one thing.
      if (window.location.hash !== target) window.history.pushState(null, "", target);
    }
  }, []);

  /*
   * The back and forward buttons.
   *
   * `popstate` is the only signal a browser gives for them, and without this
   * the URL would change while the screen did not — which is worse than the
   * original defect, because the address bar would then be lying.
   */
  useEffect(() => {
    function onPop(): void {
      const route = decode(window.location.hash) as View | undefined;
      setViewState(route ?? { kind: "courses" });
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /*
   * Whether the collapsed sidebar is showing (P30-02). Below `md` only —
   * above it the sidebar is permanent and this is ignored.
   *
   * It lives here rather than in `Shell` because what closes it is a
   * navigation click, and those buttons are built here.
   */
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * Which views need a customer to act within.
   *
   * `customers`, `staff` and `security` are above any tenant and work with none
   * — which is what makes a fresh installation recoverable: the operator can
   * create the first customer from a console that has none.
   */
  /*
   * Which screens sit **above** any customer (P127-01).
   *
   * This was the other way round — a hand-written list of the six tenant
   * screens — and it had drifted to cover six of ten. `media`, `copy`,
   * `participants` and `punktemeldungen` were all missing, so each of them
   * skipped the guard below, called a tenant-scoped route with no customer
   * header, and rendered the API's developer-facing refusal above a "Loading …"
   * that never resolved. Reported from the Mediathek, true of four screens.
   *
   * That is CLAUDE.md §9.1's second form: a check that silently covers less
   * than it claims, the same shape as `role-matrix.mjs` parsing five of nine
   * screens (P41-02). Listing the exceptions instead of the rule is what fixes
   * the class — there are three platform screens and they are the ones with a
   * reason to be here, so a screen added tomorrow is tenant-scoped by default
   * and fails into "choose a customer" rather than into a red box.
   *
   * These are exactly the screens rendered with `platformClient`: the customer
   * registry spans customers, operator accounts and sign-in rules sit above any
   * one of them, and the EIV posture (P180-01) belongs to the installation
   * rather than to a tenant — there is one worker and one register, whatever
   * customer the operator happens to have selected.
   */
  const PLATFORM_VIEWS: ReadonlySet<View["kind"]> = new Set([
    "customers",
    "platform-eiv",
    "staff",
    "security",
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

  /*
   * The clock the visibility column is read against (P201-01).
   *
   * `@ds/domain` takes time as an argument and never reads it — so somebody has
   * to supply one, and it should be the same instant for every row of a list or
   * two courses whose windows differ by a second could be described
   * inconsistently on one screen.
   *
   * Recomputed when the list is, which is what makes a course that expires
   * while somebody has the tab open say so on the next refresh rather than
   * whenever React happens to re-render.
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `courses` is not read
  // by the callback; it is the *signal*. The clock should be re-taken when the
  // list is, so a course that expires while the tab is open says so on the next
  // refresh rather than on whatever unrelated render happens next.
  const now = useMemo(() => new Date(), [courses]);
  const [problem, setProblem] = useState<string | undefined>();
  /*
   * A refused *action*, as opposed to a failed *load* (P202-01). Separate
   * because the two want opposite things from the screen: a failed load has no
   * table to show, and a refused action needs the table still on screen.
   */
  const [actionProblem, setActionProblem] = useState<string | undefined>();
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

  /*
   * Deleting a Fortbildung (P101-02).
   *
   * The list is re-read rather than filtered locally: the API refuses a course
   * with recorded participations, and `enrolmentCount` here is a snapshot that
   * may be older than the enrolment that arrived while this screen was open.
   * Dropping the row on a request the server refused would show a course as
   * gone until the next reload — the console holding a shape the server does
   * not, which is the mistake CourseStructure's header warns about one screen
   * over.
   */
  const removeCourse = useCallback(
    async (slug: string) => {
      /*
       * The refusal goes to `actionProblem`, not `problem` (P202-01).
       *
       * Two defects met here, and the client saw the sum of them: a 409 in the
       * network tab and nothing at all on the screen.
       *
       *   * This wrote the message into `problem` and then called
       *     `loadCourses()`, whose first act on success is
       *     `setProblem(undefined)`. The sentence was erased before it could
       *     render — every time, for every refusal.
       *   * And `problem` is the screen's *load* channel: rendering it replaces
       *     the whole table with an error and a retry button. That is right
       *     when the list could not be fetched and wrong when the list is fine
       *     and one action was refused — it would have hidden the very rows the
       *     message is about.
       *
       * So a refused action gets its own channel, which the reload does not
       * touch, shown above the table with the rows still there.
       */
      setActionProblem(undefined);
      try {
        await client.adminDeleteCourse(slug);
      } catch (error) {
        setActionProblem(describeError(error, de.error.generic));
      }
      await loadCourses();
    },
    [client, loadCourses],
  );

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
  /*
   * A single-customer operator sees the app's name, not their customer's
   * (P38-01, and it is a known gap rather than a choice).
   *
   * The intent was to name the customer. The lookup cannot find it: `customers`
   * is fetched only for an operator holding the `customer` capability, and that
   * capability is exactly what distinguishes a super administrator from
   * everybody else — so for the roles this branch serves, the list is always
   * empty and the fallback is always what renders.
   *
   * Naming it properly means the *session* carrying the customer's name, which
   * means a registry read from a pool that is not tenant-scoped, under a
   * `customers` policy that checks `id = app.customer_id`. That is a real
   * change with a real security surface, and it is filed rather than bodged:
   * see `docs/backlog/P38.md`. Until then this says something true.
   */
  const scope =
    props.profile.role !== "super_admin" ? (
      <span className="text-sm font-semibold text-gray-900">
        {customers.find((entry) => entry.id === customerId)?.name ?? de.appShort}
      </span>
    ) : (
      <label className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">{de.customerPicker.label}</span>
        <select
          value={customerId ?? ""}
          onChange={(event) => setCustomerId(event.target.value || undefined)}
          className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 shadow-sm transition-colors hover:border-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25"
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
  /*
   * The navigation column.
   *
   * Which groups it draws is `visibleNav`'s answer, and it is a separate pure
   * function so that "what does a `course_editor` see?" can be asked without an
   * API and a browser (§9.2 — that question is the one this table exists to
   * answer correctly).
   */
  const nav = (
    <Sidebar
      groups={visibleNav(props.profile.capabilities)}
      active={view.kind}
      onNavigate={(kind) => {
        setView({ kind } as View);
        setMenuOpen(false);
      }}
    />
  );

  /** The section the current view belongs to, for its page chrome. */
  const section = sectionFor(view.kind);

  /**
   * The frame every screen renders inside.
   *
   * `headed` wraps the body in the standard `Page` header — title, description,
   * optional actions — so a screen never draws its own. Screens that are not a
   * navigation destination (the course editor, the new-course form) pass their
   * own `Page` and use `frame` directly.
   */
  const frame = (body: React.ReactNode) => (
    <Shell
      apiBase={props.config.apiBase}
      nav={nav}
      scope={scope}
      menuOpen={menuOpen}
      onToggleMenu={() => setMenuOpen(!menuOpen)}
      operator={props.profile.displayName}
      // Always present in the console — it is what tells the frame it is signed
      // in. The prop is optional only so a test can render without one.
      onSignOut={props.onSignOut ?? (() => undefined)}
    >
      {body}
    </Shell>
  );

  const headed = (body: React.ReactNode, actions?: React.ReactNode) =>
    frame(
      <Page
        title={section?.title ?? de.appTitle}
        {...(section?.description === undefined
          ? {}
          : { description: section.description })}
        {...(actions === undefined ? {} : { actions })}
      >
        {body}
      </Page>,
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
        // Spread, not assigned: under `exactOptionalPropertyTypes` an explicit
        // `undefined` is a different value from an absent key, and only the
        // absent one encodes back to the URL without a trailing `/quiz/`.
        {...(view.quizContentId === undefined
          ? {}
          : { quizContentId: view.quizContentId })}
        onTab={(tab) => setView({ kind: "course", slug: view.slug, tab })}
        onEditQuiz={(quizContentId) =>
          setView({ kind: "course", slug: view.slug, tab: "structure", quizContentId })
        }
        onCloseQuiz={() => setView({ kind: "course", slug: view.slug, tab: "structure" })}
        onBack={() => {
          setView({ kind: "courses" });
          void loadCourses();
        }}
      />,
    );
  }

  if (view.kind === "new-course") {
    return frame(
      <Page
        title={de.newCourse.title}
        description={de.newCourse.intro}
        trail={[{ label: de.courses.title, onClick: () => setView({ kind: "courses" }) }]}
      >
        <NewCourseScreen
          client={client}
          onCreated={(slug) => {
            void loadCourses();
            setView({ kind: "course", slug, tab: "structure" });
          }}
          onCancel={() => setView({ kind: "courses" })}
        />
      </Page>,
    );
  }

  /*
   * A tenant screen with no customer chosen has nothing to act within.
   *
   * It now *asks*, rather than stating the problem and leaving the operator to
   * work out the remedy (§9.4). The two ways forward are the two controls:
   * choose one of the customers that exist, or create the first. Which of those
   * is even possible depends on the account, so the panel renders what this
   * operator can actually do rather than naming a screen they may not reach.
   */
  if (customerId === undefined && !PLATFORM_VIEWS.has(view.kind)) {
    return frame(
      <ChooseCustomerPrompt
        customers={customers}
        canCreate={props.profile.capabilities.includes("customer")}
        onChoose={setCustomerId}
        onCreate={() => setView({ kind: "customers" })}
      />,
    );
  }

  if (view.kind === "participants") {
    return headed(<ParticipantAccounts client={client} />);
  }

  if (view.kind === "learners") {
    return headed(<Learners client={client} />);
  }

  if (view.kind === "certificates") {
    return headed(<Certificates client={client} />);
  }

  if (view.kind === "punktemeldungen") {
    return headed(<EivQueue client={client} />);
  }

  if (view.kind === "staff") {
    // The platform client: operator accounts sit above any tenant, so the
    // request must not carry `X-DS-Project`.
    return headed(
      <StaffAccounts
        client={platformClient}
        ownAccountId={props.profile.id}
        customerId={props.profile.grants[0]?.customerId ?? null}
        customers={customers}
      />,
    );
  }

  if (view.kind === "security") {
    // Above any tenant, like the customer registry: no `X-DS-Project`.
    return headed(
      <Security
        client={platformClient}
        apiBase={props.config.apiBase}
        isSuperAdmin={props.profile.role === "super_admin"}
        ownSecondFactorEnrolled={props.profile.secondFactorEnrolled}
        customers={customers}
      />,
    );
  }

  if (view.kind === "customers") {
    // The platform client: no `X-DS-Project` header, because this list spans
    // customers and has to work before any project exists.
    return headed(
      <Customers
        client={platformClient}
        onChanged={() => {
          void loadCustomers();
        }}
      />,
    );
  }

  if (view.kind === "branding") {
    // A department_admin gets a 403 from the PUT; the screen renders for them
    // because the API, not the navigation, is the gate (P9-01).
    return headed(<BrandingSettings client={client} />);
  }

  if (view.kind === "copy") {
    // Like branding: the screen renders and the API is the gate on the write.
    return headed(<CopySettings client={client} />);
  }

  if (view.kind === "platform-eiv") {
    /*
     * The **platform** client, not the tenant one: this setting has no
     * customer and the route sends no `X-DS-Project` (P180-01). Handed the
     * same way `Customers` is, for the same reason.
     */
    return headed(<PlatformEiv client={platformClient} />);
  }

  if (view.kind === "media") {
    // Like branding and Texte: the screen renders and the API is the gate on
    // every write it offers.
    return headed(<MediaLibrary client={client} />);
  }

  if (view.kind === "organisation") {
    return headed(<Organisation client={client} apiBase={props.config.apiBase} />);
  }

  return headed(
    <>
      {courses.length === 0 ? (
        <EmptyState
          title={de.courses.empty}
          description={de.courses.emptyHint}
          action={
            <Button onClick={() => setView({ kind: "new-course" })}>
              {de.newCourse.action}
            </Button>
          }
        />
      ) : (
        <>
          {/*
          The rule, once, above the table — the same shape as the structure
          screen (P100-01): identical on every row, so it belongs where the
          screen is explained rather than repeated per line.
        */}
          <p className="mb-3 max-w-3xl text-sm text-gray-600">{de.courses.deleteRule}</p>
          {/*
            A refused action, above the rows it is about (P202-01).

            Dismissible, and cleared by the next attempt, because it describes
            one act rather than the state of the screen — an error that outlives
            what caused it is an error somebody learns to ignore.

            `role="alert"` so it is announced: the button that produced it may
            have been the last thing focused, and a message that appears
            silently below the focus ring is a message a screen-reader user
            never learns about.
          */}
          {actionProblem === undefined ? null : (
            <div role="alert" className="mb-3">
              <Notice tone="error" title={de.error.title}>
                <div className="flex items-start justify-between gap-4">
                  <span>{actionProblem}</span>
                  <button
                    type="button"
                    className="shrink-0 rounded text-sm font-medium underline underline-offset-2"
                    onClick={() => setActionProblem(undefined)}
                  >
                    {de.common.dismiss}
                  </button>
                </div>
              </Notice>
            </div>
          )}
          <Table
            headers={[
              de.courses.columnTitle,
              de.courses.columnVnr,
              de.courses.columnPoints,
              de.courses.columnParticipants,
              de.courses.columnCertificate,
              de.courses.columnVisibility,
              de.courses.columnActions,
            ]}
          >
            {courses.map((course) => (
              <tr
                key={course.slug}
                className="border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50/70"
              >
                <td className="px-4 py-3">
                  <button
                    type="button"
                    /*
                     * The title is the row, so it is set as a title and not as
                     * a link that happens to be a title.
                     *
                     * It was permanently underlined, which in a table of two
                     * columns of prose reads as raw hypertext and competes with
                     * the data beside it — and on a long German course name it
                     * wraps to two underlined lines, which was the widest thing
                     * on the screen. The underline appears on hover and focus,
                     * where it is doing the work of saying "this is clickable";
                     * at rest the colour and weight already do (§9.4 is about
                     * saying what a thing is, and a brand-coloured semibold
                     * title in a list of grey cells says it).
                     */
                    className="rounded text-left font-semibold text-brand-700 underline-offset-2 transition-colors hover:text-brand-800 hover:underline focus-visible:underline"
                    onClick={() =>
                      setView({ kind: "course", slug: course.slug, tab: "structure" })
                    }
                  >
                    {course.title}
                  </button>
                  {/*
                   * Visible from the list, because "why can I not edit this
                   * course" is a question somebody asks before they have
                   * opened it (P178-01).
                   */}
                  {course.contentLocked ? (
                    <Badge tone="muted">{de.courses.lockedBadge}</Badge>
                  ) : null}
                </td>
                {/* A VNR is a seventeen-digit number nobody reads as prose —
                    it is compared, digit by digit, against a Bescheid. */}
                <td className="px-4 py-3 tabular-nums text-gray-600">
                  {course.vnr ?? "—"}
                </td>
                {/* Tabular figures, so 3 and 12 line up on their units rather
                    than on their left edge — a column of CME points is read by
                    comparing it down the page. */}
                <td className="px-4 py-3 tabular-nums">
                  {course.cmePoints === null
                    ? "—"
                    : `${course.cmePoints} (${course.cmeCategory ?? "?"})`}
                </td>
                {/* `whitespace-nowrap`: "0 von 0 abgeschlossen" wrapped after
                    the numbers, so a row carrying it was two lines tall and
                    every other row was one. A column of counts that changes the
                    row height is the jagged-list defect DEP-42 reported on the
                    learner's catalogue, in the console. */}
                <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                  {de.courses.completedOf(course.completedCount, course.enrolmentCount)}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={course.certificateReady ? "ok" : "warn"}>
                    {course.certificateReady
                      ? de.courses.certificateReady
                      : de.courses.certificateNotReady}
                  </Badge>
                </td>
                {/*
                  Why this course is or is not reaching learners (P201-01).
                  See `visibilityOf` for the rule and why it is that function.
                */}
                <td className="px-4 py-3">
                  <VisibilityCell course={course} now={now} />
                </td>
                <td className="px-4 py-3">
                  <ConfirmButton
                    label={de.courses.delete}
                    aria-label={de.courses.deleteAria(course.title)}
                    confirmLabel={de.courses.deleteConfirm}
                    cancelLabel={de.common.cancel}
                    disabledReason={
                      course.enrolmentCount > 0
                        ? de.courses.lockedByEnrolments
                        : undefined
                    }
                    lockedLabel={de.structure.locked}
                    onConfirm={() => {
                      void removeCourse(course.slug);
                    }}
                  />
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>,
    /*
     * No header action while the list is empty — the empty state is already
     * offering it, and two identical buttons on one screen is both a choice
     * nobody has to make and an accessible-name collision.
     */
    courses.length === 0 ? undefined : (
      <Button onClick={() => setView({ kind: "new-course" })}>
        {de.newCourse.action}
      </Button>
    ),
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
  /**
   * The quiz open under the structure tab, from the address bar (P74-06).
   *
   * It used to be React state here, which made the quiz editor a place with no
   * address: Back left the console instead of closing it, F5 lost it, and there
   * was nothing to send anybody. Reported as *"when in here i added a question,
   * i can not easily go back to the inhalt darstellung"*.
   */
  quizContentId?: string;
  onTab: (tab: CourseTab) => void;
  onEditQuiz: (contentId: string) => void;
  onCloseQuiz: () => void;
  onBack: () => void;
}) {
  const [course, setCourse] = useState<AdminCourseDetail | undefined>();
  const [participants, setParticipants] = useState<ParticipantList | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  /**
   * The title of the quiz's content item, for the heading.
   *
   * State rather than route, and the distinction matters: *which* quiz is open
   * is addressable and belongs in the URL, but its title is a fact the server
   * owns. Somebody arriving on a link has an id and no title yet, and the
   * heading falls back to "Lernerfolgskontrolle" — which is true, rather than a
   * title guessed from a url.
   */
  const [quizTitle, setQuizTitle] = useState<string | undefined>();

  const { client, slug, tab } = props;
  // A quiz only exists under the structure tab. Deriving it rather than
  // clearing it in an effect means the two can never briefly disagree.
  const quizContentId = tab === "structure" ? props.quizContentId : undefined;

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

  /*
   * Where the operator is (P30-02).
   *
   * The course editor is the deep part of this console — Fortbildungen →
   * a course → a tab → a quiz — and until now the only clue about which of
   * those you were in was a "Zurück" button that did not say where back was.
   * The trail replaces it: every level above is named and one click away, which
   * is both more information and one fewer control.
   */
  const courseLabel = course?.title ?? props.slug;
  // The trail names the levels *above*; the heading names where you are. So a
  // quiz pushes the course into the trail rather than repeating it.
  const trail: Crumb[] =
    quizContentId === undefined
      ? [{ label: de.courses.title, onClick: props.onBack }]
      : [
          { label: de.courses.title, onClick: props.onBack },
          { label: courseLabel, onClick: props.onCloseQuiz },
        ];

  return (
    <Page
      title={
        quizContentId === undefined
          ? courseLabel
          : quizTitle === undefined
            ? de.quiz.title
            : `${de.quiz.title} — ${quizTitle}`
      }
      trail={trail}
    >
      {/*
        Scrolls, never wraps (P100-01).

        `flex-wrap` put the six course tabs on two rows below about 700px — the
        second row reading as a separate control, and the whole header growing
        by a line exactly when vertical space is scarcest. A horizontal scroller
        keeps them one row at any width, which is what every tab strip on a
        phone does. `scrollbar-none` hides the bar; the overflow is still
        keyboard- and touch-scrollable, and the fade at the edge is the affordance.
      */}
      <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {COURSE_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? "page" : undefined}
            onClick={() => props.onTab(value)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
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
        {...(quizContentId === undefined ? {} : { quizContentId })}
        onEditQuiz={(contentId, title) => {
          setQuizTitle(title);
          props.onEditQuiz(contentId);
        }}
        onCloseQuiz={props.onCloseQuiz}
        onCourseSaved={setCourse}
      />
    </Page>
  );
}

function CourseTabContent(props: {
  client: ApiClient;
  slug: string;
  tab: CourseTab;
  course: AdminCourseDetail | undefined;
  participants: ParticipantList | undefined;
  quizContentId?: string;
  onEditQuiz: (contentId: string, title: string) => void;
  onCloseQuiz: () => void;
  onCourseSaved: (course: AdminCourseDetail) => void;
}) {
  const { client, slug } = props;

  /*
   * The three screens below wait for the course row before drawing anything
   * (P178-01).
   *
   * They used to render immediately and fetch their own tree, which was right
   * while nothing about the course changed what they offered. `contentLocked`
   * does: rendering them optimistically would draw "Löschen" and "Inhalt
   * hinzufügen" on a locked course for as long as the request takes, and a
   * control that appears and then vanishes is worse than one that arrives a
   * moment late. Presentation and Einstellungen have waited on the same row
   * since they were written.
   */
  const contentLocked = props.course?.contentLocked ?? false;

  switch (props.tab) {
    case "structure":
      if (props.course === undefined) return <Spinner label={de.loading} />;
      return props.quizContentId === undefined ? (
        <CourseStructureEditor
          client={client}
          courseSlug={slug}
          contentLocked={contentLocked}
          onEditQuiz={props.onEditQuiz}
        />
      ) : (
        <QuizEditor
          client={client}
          contentId={props.quizContentId}
          contentLocked={contentLocked}
          onDone={props.onCloseQuiz}
        />
      );

    case "experts":
      // Referenten are presentation, like the title and the hero image, and
      // the lock deliberately does not cover them — see the migration header.
      return <ExpertsEditor client={client} courseSlug={slug} />;

    case "evaluation":
      if (props.course === undefined) return <Spinner label={de.loading} />;
      return (
        <EvaluationEditor
          client={client}
          courseSlug={slug}
          contentLocked={contentLocked}
        />
      );

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
