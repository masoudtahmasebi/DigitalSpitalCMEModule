/**
 * The admin console shell (P9-01).
 *
 * ## Navigation shows only what the role may reach — and that is not the gate
 *
 * A `department_admin` sees no edit form because the console does not render
 * one for them. That is a courtesy. The refusal lives in the API, which 403s
 * `PATCH /admin/courses/{slug}` for anyone below `customer_admin` regardless of
 * what the client chose to draw. Any screen here could be reached by typing a
 * URL, and none of them would work.
 *
 * The console cannot read roles out of the token, and deliberately does not
 * try: parsing a JWT client-side to decide what to show is one small step from
 * parsing it to decide what to allow. Instead it asks the API and adapts to
 * what comes back — a 403 on the course list means "not an admin", and that is
 * the API's answer, not a guess.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminCourseDetail, AdminCourseSummary, ParticipantList } from "@ds/sdk";
import { readConfig } from "./config.js";
import { beginLogin, completeLogin, currentSession, logout } from "./auth.js";
import { createAdminClient, describeError, isForbidden } from "./api.js";
import { de } from "./locale/de.js";
import { Badge, Button, Notice, Spinner, Table } from "./components/ui.js";
import { BrandingSettings } from "./components/BrandingSettings.js";
import { CourseSettings } from "./components/CourseSettings.js";
import { Participants } from "./components/Participants.js";

type AuthState = "checking" | "anonymous" | "signed-in" | "failed";

export function App() {
  const config = useMemo(() => readConfig(), []);
  const [auth, setAuth] = useState<AuthState>("checking");

  useEffect(() => {
    if (config === undefined) return;

    completeLogin(config)
      .then((session) => {
        setAuth(
          session === undefined && currentSession() === undefined
            ? "anonymous"
            : "signed-in",
        );
      })
      .catch(() => setAuth("failed"));
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

  if (auth === "checking") {
    return (
      <Shell>
        <Spinner label={de.auth.signingIn} />
      </Shell>
    );
  }

  if (auth !== "signed-in") {
    return (
      <Shell>
        <div className="space-y-4">
          {auth === "failed" ? (
            <Notice tone="error" title={de.error.title}>
              {de.auth.failed}
            </Notice>
          ) : (
            <p className="text-sm text-gray-700">{de.auth.required}</p>
          )}
          <Button onClick={() => void beginLogin(config)}>{de.auth.signIn}</Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onSignOut={() => logout(config)}>
      <Console config={config} onExpired={() => setAuth("anonymous")} />
    </Shell>
  );
}

function Shell(props: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <h1 className="text-lg font-bold text-gray-900">{de.appTitle}</h1>
        {props.onSignOut === undefined ? null : (
          <Button variant="secondary" onClick={props.onSignOut}>
            {de.auth.signOut}
          </Button>
        )}
      </header>
      {props.children}
    </div>
  );
}

type View =
  | { kind: "courses" }
  | { kind: "branding" }
  | { kind: "course"; slug: string; tab: "settings" | "participants" };

function Console(props: {
  config: ReturnType<typeof readConfig> & object;
  onExpired: () => void;
}) {
  const client = useMemo(
    () => createAdminClient(props.config, props.onExpired),
    [props.config, props.onExpired],
  );

  const [view, setView] = useState<View>({ kind: "courses" });
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

  // Two top-level sections. Branding is project-wide rather than per course —
  // the typeface is a property of the customer, not of one Fortbildung — so it
  // sits beside the course list rather than inside a course.
  const sections = (
    <nav className="flex gap-1 border-b border-gray-200">
      {(
        [
          ["courses", de.nav.courses],
          ["branding", de.nav.branding],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-current={view.kind === value ? "page" : undefined}
          onClick={() => setView({ kind: value })}
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
  );

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

  return (
    <section className="space-y-4">
      {sections}
      <h2 className="text-base font-semibold text-gray-900">{de.courses.title}</h2>

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
                    setView({ kind: "course", slug: course.slug, tab: "settings" })
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

function CourseScreen(props: {
  client: ReturnType<typeof createAdminClient>;
  slug: string;
  tab: "settings" | "participants";
  onTab: (tab: "settings" | "participants") => void;
  onBack: () => void;
}) {
  const [course, setCourse] = useState<AdminCourseDetail | undefined>();
  const [participants, setParticipants] = useState<ParticipantList | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

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

      <nav className="flex gap-1 border-b border-gray-200">
        {(
          [
            ["settings", de.course.settings],
            ["participants", de.participants.title],
          ] as const
        ).map(([value, label]) => (
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

      {course === undefined ? (
        <Spinner label={de.loading} />
      ) : tab === "settings" ? (
        <CourseSettings client={client} course={course} onSaved={setCourse} />
      ) : participants === undefined ? (
        <Spinner label={de.loading} />
      ) : (
        <Participants client={client} courseSlug={props.slug} list={participants} />
      )}
    </section>
  );
}
