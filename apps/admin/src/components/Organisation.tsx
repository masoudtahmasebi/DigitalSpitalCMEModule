/**
 * Departments and projects (P9-02).
 *
 * ## Why this screen carries the Keycloak binding
 *
 * A project is a host surface — a customer's WordPress site, or the standalone
 * portal — and it decides which Keycloak realm every token presented against it
 * is validated against (ADR-0003, ADR-0007). That makes these three fields the
 * most dangerous inputs in the console: a wrong issuer locks every learner of
 * that project out at once, with a 401 that says nothing.
 *
 * The screen warns before the fields rather than validating them, because there
 * is nothing useful to validate client-side. Whether an issuer is right is
 * decided by whether Keycloak answers at `/.well-known/openid-configuration`,
 * and that is a question for whoever configured the realm.
 *
 * ## The SMTP password
 *
 * Write-only, like the VNR password. The form shows whether one is stored and
 * offers to replace it; there is no field capable of displaying it, because
 * `ProjectSummary` has no field capable of carrying it (CLAUDE.md §4
 * invariant 7). Leaving the box empty keeps what is stored — an admin editing
 * the sender name must not silently clear the credential.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiClient, DepartmentSummary, ProjectSummary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { invalidEmbedOriginPatterns } from "@ds/domain";
import { slugify } from "../drafts.js";
import { readPlatformSender } from "../staff-auth.js";
import { useLoaded, useSaver } from "../hooks.js";
import {
  Button,
  Field,
  Notice,
  Panel,
  Row,
  RowList,
  SaveProblem,
  Select,
  Spinner,
  Table,
  TextArea,
  TextInput,
} from "./ui.js";

export function Organisation(props: { client: ApiClient; apiBase: string }) {
  const { client, apiBase } = props;

  const loadDepartments = useCallback(() => client.adminListDepartments(), [client]);
  const loadProjects = useCallback(() => client.adminListProjects(), [client]);

  const [departments, setDepartments, departmentProblem] = useLoaded(loadDepartments);
  const [projects, setProjects, projectProblem] = useLoaded(loadProjects);

  /*
   * The platform's own sender address, for the sentence under each project's
   * SMTP fields (P185-01).
   *
   * The **same** endpoint Sicherheit → Plattform-Versand reads and writes, so
   * the address named here is the address that screen sets and the worker
   * sends from — one value, one home (§9.10b). Asking a different source would
   * be a second answer to "who sends this", and the two would disagree on the
   * day somebody changed one.
   *
   * `canSend` is the server's own verdict on whether the sender is complete,
   * not a rule restated in the browser; a From address stored beside no host
   * sends nothing, and promising it here would be §9.2 — an affordance the
   * system will refuse.
   *
   * `null` covers three different things — still loading, none configured, and
   * an endpoint that answered anything but 200 — and all three mean the same
   * thing on that sentence: do not promise a fallback. A screen that said "we
   * will send it for you" because a request had not landed yet would be worse
   * than one that says nothing.
   */
  const [platformSender, setPlatformSender] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readPlatformSender(apiBase).then((sender) => {
      if (!live || sender === undefined) return;
      setPlatformSender(sender.canSend ? sender.fromAddress : null);
    });
    return () => {
      live = false;
    };
  }, [apiBase]);

  const problem = departmentProblem ?? projectProblem;

  return (
    // No heading here: `Page` draws it from the navigation entry (P30-02).
    <section className="space-y-6">
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {departments === undefined ? (
        <Spinner label={de.loading} />
      ) : (
        <Departments
          client={client}
          departments={departments}
          onChange={setDepartments}
        />
      )}

      {projects === undefined || departments === undefined ? null : (
        <Projects
          client={client}
          platformSender={platformSender}
          projects={projects}
          departments={departments}
          onChange={setProjects}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

function Departments(props: {
  client: ApiClient;
  departments: readonly DepartmentSummary[];
  onChange: (next: DepartmentSummary[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();

  return (
    <Panel
      title={de.organisation.departments}
      actions={
        adding ? null : (
          <Button onClick={() => setAdding(true)}>{de.organisation.newDepartment}</Button>
        )
      }
    >
      {adding ? (
        <NewDepartment
          client={props.client}
          onDone={(next) => {
            props.onChange(next);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : props.departments.length === 0 ? (
        <p className="text-sm text-gray-600">{de.organisation.departmentsEmpty}</p>
      ) : (
        <Table
          headers={[de.common.name, de.common.slug, de.organisation.columnProjects, ""]}
        >
          {props.departments.map((department) => (
            <tr key={department.slug} className="border-b border-gray-100 align-top">
              <td>
                {editing === department.slug ? (
                  <RenameDepartment
                    client={props.client}
                    department={department}
                    onDone={(next) => {
                      props.onChange(next);
                      setEditing(undefined);
                    }}
                    onCancel={() => setEditing(undefined)}
                  />
                ) : (
                  <span className="font-medium text-gray-900">{department.name}</span>
                )}
              </td>
              <td className="font-mono text-xs text-gray-600">{department.slug}</td>
              <td className="text-gray-700">{department.projectCount}</td>
              <td className="text-right">
                {editing === department.slug ? null : (
                  <Button
                    variant="secondary"
                    ariaLabel={de.common.editDepartment(department.name)}
                    onClick={() => setEditing(department.slug)}
                  >
                    {de.common.edit}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function NewDepartment(props: {
  client: ApiClient;
  onDone: (next: DepartmentSummary[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);
  const saver = useSaver();

  const effectiveSlug = touchedSlug ? slug : slugify(name);

  return (
    <form
      className="max-w-xl space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void saver
          .run(async () =>
            props.onDone(
              await props.client.adminCreateDepartment({
                slug: effectiveSlug,
                name: name.trim(),
              }),
            ),
          )
          .then(() => undefined);
      }}
    >
      <Field label={de.common.name} htmlFor="new-department-name">
        <TextInput
          id="new-department-name"
          value={name}
          maxLength={300}
          onChange={setName}
        />
      </Field>
      <Field
        label={de.common.slug}
        hint={de.common.slugHint}
        htmlFor="new-department-slug"
      >
        <TextInput
          id="new-department-slug"
          value={effectiveSlug}
          maxLength={100}
          onChange={(value) => {
            setTouchedSlug(true);
            setSlug(value);
          }}
        />
      </Field>

      <SaveProblem title={de.error.title} problem={saver.problem} />

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={
            saver.state === "saving" || name.trim() === "" || effectiveSlug === ""
          }
        >
          {saver.state === "saving" ? de.common.saving : de.common.add}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {de.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function RenameDepartment(props: {
  client: ApiClient;
  department: DepartmentSummary;
  onDone: (next: DepartmentSummary[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.department.name);
  const saver = useSaver();

  return (
    <div className="space-y-2">
      <TextInput
        id={`department-name-${props.department.slug}`}
        value={name}
        maxLength={300}
        onChange={setName}
      />
      {saver.problem === undefined ? null : (
        <p className="text-xs font-medium text-red-700">{saver.problem}</p>
      )}
      <div className="flex gap-2">
        <Button
          disabled={saver.state === "saving" || name.trim() === ""}
          onClick={() => {
            void saver.run(async () =>
              props.onDone(
                await props.client.adminUpdateDepartment(props.department.slug, {
                  name: name.trim(),
                }),
              ),
            );
          }}
        >
          {saver.state === "saving" ? de.common.saving : de.common.save}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {de.common.cancel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function Projects(props: {
  /** See `ProjectSettings`. */
  platformSender: string | null;
  client: ApiClient;
  projects: readonly ProjectSummary[];
  departments: readonly DepartmentSummary[];
  onChange: (next: ProjectSummary[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | undefined>();

  const canAdd = props.departments.length > 0;

  return (
    <Panel
      title={de.organisation.projects}
      actions={
        adding || !canAdd ? null : (
          <Button onClick={() => setAdding(true)}>{de.organisation.newProject}</Button>
        )
      }
    >
      {adding ? (
        <NewProject
          client={props.client}
          departments={props.departments}
          onDone={(next) => {
            props.onChange(next);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : props.projects.length === 0 ? (
        <p className="text-sm text-gray-600">{de.organisation.projectsEmpty}</p>
      ) : (
        <RowList>
          {props.projects.map((project) => (
            <Row
              key={project.slug}
              title={
                <span>
                  {project.name}{" "}
                  <span className="font-mono text-xs font-normal text-gray-500">
                    {project.slug}
                  </span>
                </span>
              }
              actions={
                <Button
                  variant="secondary"
                  {...(open === project.slug
                    ? {}
                    : { ariaLabel: de.common.editProject(project.name) })}
                  onClick={() =>
                    setOpen(open === project.slug ? undefined : project.slug)
                  }
                >
                  {open === project.slug ? de.common.cancel : de.common.edit}
                </Button>
              }
            >
              {open === project.slug ? (
                <ProjectSettings
                  client={props.client}
                  project={project}
                  platformSender={props.platformSender}
                  onDone={(next) => {
                    props.onChange(next);
                    setOpen(undefined);
                  }}
                />
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <Summary
                    label={de.organisation.columnDepartment}
                    value={project.departmentSlug}
                  />
                  <Summary
                    label={de.organisation.columnCourses}
                    value={String(project.courseCount)}
                  />
                  <Summary
                    label={de.organisation.columnRealm}
                    value={project.keycloakRealm ?? "—"}
                  />
                  <Summary
                    label={de.organisation.smtpHost}
                    value={project.smtpHost ?? "—"}
                  />
                </dl>
              )}
            </Row>
          ))}
        </RowList>
      )}
    </Panel>
  );
}

function Summary(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{props.label}</dt>
      <dd className="text-gray-800">{props.value}</dd>
    </div>
  );
}

/**
 * The two ways a project's participants can sign in (ADR-0012).
 *
 * Offered at creation rather than only in the settings form because a project
 * created without the choice defaults to `keycloak`, and a customer who wanted
 * the standalone portal would get a project whose participants cannot sign in
 * at all — which is exactly the defect P28-02 fixed one layer down. An API that
 * accepts a value the console cannot send is not a fixed bug.
 */
const IDENTITY_PROVIDER_OPTIONS = [
  ["keycloak", de.organisation.identityProviderKeycloak],
  ["local", de.organisation.identityProviderLocal],
] as const;

type IdentityProviderValue = (typeof IDENTITY_PROVIDER_OPTIONS)[number][0];

function NewProject(props: {
  client: ApiClient;
  departments: readonly DepartmentSummary[];
  onDone: (next: ProjectSummary[]) => void;
  onCancel: () => void;
}) {
  const first = props.departments[0];
  const [departmentSlug, setDepartmentSlug] = useState(first?.slug ?? "");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [identityProvider, setIdentityProvider] =
    useState<IdentityProviderValue>("keycloak");
  const saver = useSaver();

  const effectiveSlug = touchedSlug ? slug : slugify(name);
  const options = useMemo(
    () => props.departments.map((d) => [d.slug, d.name] as const),
    [props.departments],
  );

  return (
    <form
      className="max-w-xl space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void saver.run(async () =>
          props.onDone(
            await props.client.adminCreateProject({
              departmentSlug,
              slug: effectiveSlug,
              name: name.trim(),
              identityProvider,
            }),
          ),
        );
      }}
    >
      <Field label={de.organisation.columnDepartment} htmlFor="new-project-department">
        <Select
          id="new-project-department"
          value={departmentSlug}
          options={options}
          onChange={setDepartmentSlug}
        />
      </Field>
      <Field label={de.common.name} htmlFor="new-project-name">
        <TextInput
          id="new-project-name"
          value={name}
          maxLength={300}
          onChange={setName}
        />
      </Field>
      <Field label={de.common.slug} hint={de.common.slugHint} htmlFor="new-project-slug">
        <TextInput
          id="new-project-slug"
          value={effectiveSlug}
          maxLength={100}
          onChange={(value) => {
            setTouchedSlug(true);
            setSlug(value);
          }}
        />
      </Field>
      <Field
        label={de.organisation.identityProvider}
        hint={de.organisation.identityProviderHint}
        htmlFor="new-project-identity-provider"
      >
        <Select
          id="new-project-identity-provider"
          value={identityProvider}
          options={IDENTITY_PROVIDER_OPTIONS}
          onChange={(value) => setIdentityProvider(value as IdentityProviderValue)}
        />
      </Field>

      <SaveProblem title={de.error.title} problem={saver.problem} />

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={
            saver.state === "saving" || name.trim() === "" || effectiveSlug === ""
          }
        >
          {saver.state === "saving" ? de.common.saving : de.common.add}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {de.common.cancel}
        </Button>
      </div>
    </form>
  );
}

function ProjectSettings(props: {
  client: ApiClient;
  project: ProjectSummary;
  /**
   * The address the platform sends as when this project has no server of its
   * own, or null when it has none either (P185-01). Read once by `Projects` and
   * passed down rather than fetched per form, so opening three projects does
   * not ask the same question three times.
   */
  platformSender: string | null;
  onDone: (next: ProjectSummary[]) => void;
}) {
  const { project } = props;
  const [name, setName] = useState(project.name);
  const [identityProvider, setIdentityProvider] = useState<IdentityProviderValue>(
    project.identityProvider,
  );
  const [issuer, setIssuer] = useState(project.keycloakIssuer ?? "");
  const [audience, setAudience] = useState(project.keycloakAudience ?? "");
  const [realm, setRealm] = useState(project.keycloakRealm ?? "");
  // One origin per line. A comma-separated box invites a trailing comma and an
  // entry with a space in it, both of which the API refuses and neither of
  // which looks wrong on screen.
  const [embedOrigins, setEmbedOrigins] = useState(project.embedOrigins.join("\n"));
  /*
   * The lines the API will refuse, named before it does (P94-04).
   *
   * `invalidEmbedOriginPatterns` is `@ds/domain`'s and the DTO enforces the
   * same rule per element — but a 422 names the *field*, so an operator with
   * six origins and one typo is told "embedOrigins" and left to find it. This
   * is the same rule read forwards, which is what `invalidBrandingFields`
   * exists for one field down and is the shape P41-01 was about: a rule that
   * refuses without saying which value it refused is a rule somebody argues
   * with.
   *
   * The values are shown, not hidden. §9.5's rule is about values that identify
   * a person; a hostname the operator typed thirty seconds ago is not one, and
   * an error that will not repeat the input is unusable here.
   */
  const rejectedOrigins = invalidEmbedOriginPatterns(originLines(embedOrigins));
  const [smtpHost, setSmtpHost] = useState(project.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(
    project.smtpPort === null ? "" : String(project.smtpPort),
  );
  const [smtpUsername, setSmtpUsername] = useState(project.smtpUsername ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromAddress, setSmtpFromAddress] = useState(project.smtpFromAddress ?? "");
  const [smtpFromName, setSmtpFromName] = useState(project.smtpFromName ?? "");
  const [loginUrl, setLoginUrl] = useState(project.loginUrl ?? "");
  const [branding, setBranding] = useState(() => brandingForm(project));
  const saver = useSaver();

  // Both or neither (P29-02). The API drops a half-configured pair silently —
  // correctly, since a consent record naming no document proves nothing — and
  // an operator who typed one field deserves to be told rather than to save
  // successfully and find the checkbox still absent.
  const policyIncomplete =
    (branding.privacyPolicyUrl.trim() === "") !==
    (branding.privacyPolicyVersion.trim() === "");

  const id = (field: string) => `project-${project.slug}-${field}`;

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void saver.run(async () =>
          props.onDone(
            await props.client.adminUpdateProject(project.slug, {
              name: name.trim(),
              identityProvider,
              loginUrl: blankToNull(loginUrl),
              keycloakIssuer: blankToNull(issuer),
              keycloakAudience: blankToNull(audience),
              keycloakRealm: blankToNull(realm),
              embedOrigins: originLines(embedOrigins),
              smtpHost: blankToNull(smtpHost),
              smtpPort: smtpPort.trim() === "" ? null : Number(smtpPort),
              smtpUsername: blankToNull(smtpUsername),
              // Absent, not null: an empty box means "keep what is stored".
              ...(smtpPassword === "" ? {} : { smtpPassword }),
              smtpFromAddress: blankToNull(smtpFromAddress),
              smtpFromName: blankToNull(smtpFromName),
              // Sent whole: `parseBranding` validates the object and stores the
              // parsed result, so a partial patch would drop everything absent.
              branding: brandingPayload(branding),
            }),
          ),
        );
      }}
    >
      <Field label={de.common.name} htmlFor={id("name")}>
        <TextInput id={id("name")} value={name} maxLength={300} onChange={setName} />
      </Field>

      <Field
        label={de.organisation.identityProvider}
        hint={de.organisation.identityProviderHint}
        htmlFor={id("identity-provider")}
      >
        <Select
          id={id("identity-provider")}
          value={identityProvider}
          options={IDENTITY_PROVIDER_OPTIONS}
          onChange={(value) => setIdentityProvider(value as IdentityProviderValue)}
        />
      </Field>

      {/*
        Where a customer's site is named, since P18-04. It used to be
        `EXTRA_CORS_ORIGINS` in the deployment's env file, which made it the
        union across every customer on the installation: adding a second
        customer widened the permission for the first, and only somebody with
        SSH could change it.
      */}
      <Field
        label={de.organisation.embedOrigins}
        hint={de.organisation.embedOriginsHint}
        htmlFor={id("origins")}
      >
        <TextArea
          id={id("origins")}
          value={embedOrigins}
          rows={3}
          onChange={setEmbedOrigins}
        />
        {rejectedOrigins.length === 0 ? null : (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {de.organisation.embedOriginsRejected(rejectedOrigins)}
          </p>
        )}
      </Field>

      {/*
        Where the customer's own login lives (P29-03).

        The column, the `resolve_project_signin` lookup and the portal's
        branch on it all existed; nothing could write it, so every project
        answered "use the portal's own form" whatever the customer actually
        used. MEDICE sign in through WordPress, and this is the field that
        says so.
      */}
      <Field
        label={de.organisation.loginUrl}
        hint={de.organisation.loginUrlHint}
        htmlFor={id("login-url")}
      >
        <TextInput
          id={id("login-url")}
          value={loginUrl}
          maxLength={2000}
          onChange={setLoginUrl}
        />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900">
          {de.organisation.keycloak}
        </legend>
        <Notice tone={identityProvider === "local" ? "info" : "warning"}>
          {identityProvider === "local"
            ? de.organisation.identityProviderLocalNote
            : de.organisation.keycloakWarning}
        </Notice>
        <Field
          label={de.organisation.issuer}
          hint={de.organisation.issuerHint}
          htmlFor={id("issuer")}
        >
          <TextInput
            id={id("issuer")}
            value={issuer}
            maxLength={2000}
            onChange={setIssuer}
          />
        </Field>
        <Field label={de.organisation.audience} htmlFor={id("audience")}>
          <TextInput
            id={id("audience")}
            value={audience}
            maxLength={200}
            onChange={setAudience}
          />
        </Field>
        <Field label={de.organisation.realm} htmlFor={id("realm")}>
          <TextInput id={id("realm")} value={realm} maxLength={200} onChange={setRealm} />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900">
          {de.organisation.smtp}
        </legend>
        <p className="text-xs text-gray-600">{de.organisation.smtpIntro}</p>
        {/*
          Which sender this project will actually use (P185-01).

          The client asked for exactly this — "we should make that clear in the
          customer page" — and it is §9.4: the field above decides something
          the operator cannot otherwise see, because the fallback lives on
          another screen they may not have access to.

          The sentence also carries the part nobody would guess: their own From
          address does **not** get used over our server. A customer's address on
          the platform's transport fails SPF and is quarantined at the far end,
          after our own SMTP succeeded — so it is said here, where somebody is
          deciding whether to fill these fields in.
        */}
        <p className="text-xs text-gray-600">
          {props.platformSender === null
            ? de.organisation.smtpNoFallback
            : de.organisation.smtpFallback(props.platformSender)}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={de.organisation.smtpHost} htmlFor={id("smtp-host")}>
            <TextInput
              id={id("smtp-host")}
              value={smtpHost}
              maxLength={300}
              onChange={setSmtpHost}
            />
          </Field>
          <Field label={de.organisation.smtpPort} htmlFor={id("smtp-port")}>
            <TextInput
              id={id("smtp-port")}
              value={smtpPort}
              type="number"
              onChange={setSmtpPort}
            />
          </Field>
          <Field label={de.organisation.smtpUsername} htmlFor={id("smtp-username")}>
            <TextInput
              id={id("smtp-username")}
              value={smtpUsername}
              maxLength={300}
              autoComplete="off"
              onChange={setSmtpUsername}
            />
          </Field>
          <Field
            label={de.organisation.smtpPassword}
            hint={de.organisation.smtpPasswordHint}
            htmlFor={id("smtp-password")}
          >
            <TextInput
              id={id("smtp-password")}
              value={smtpPassword}
              type="password"
              maxLength={300}
              autoComplete="new-password"
              onChange={setSmtpPassword}
            />
          </Field>
          <Field label={de.organisation.smtpFromAddress} htmlFor={id("smtp-from")}>
            <TextInput
              id={id("smtp-from")}
              value={smtpFromAddress}
              type="email"
              maxLength={300}
              onChange={setSmtpFromAddress}
            />
          </Field>
          <Field label={de.organisation.smtpFromName} htmlFor={id("smtp-from-name")}>
            <TextInput
              id={id("smtp-from-name")}
              value={smtpFromName}
              maxLength={200}
              onChange={setSmtpFromName}
            />
          </Field>
        </div>
        <p className="text-xs text-gray-600">
          {project.hasSmtpPassword
            ? de.organisation.smtpPasswordStored
            : de.organisation.smtpPasswordMissing}
        </p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900">
          {de.organisation.branding}
        </legend>
        <p className="text-xs text-gray-600">{de.organisation.brandingIntro}</p>

        <Field
          label={de.organisation.catalogTitle}
          hint={de.organisation.catalogTitleHint}
          htmlFor={id("catalog-title")}
        >
          <TextInput
            id={id("catalog-title")}
            value={branding.catalogTitle}
            maxLength={120}
            onChange={(v) => setBranding((b) => ({ ...b, catalogTitle: v }))}
          />
        </Field>
        <Field label={de.organisation.catalogIntro} htmlFor={id("catalog-intro")}>
          <TextArea
            id={id("catalog-intro")}
            value={branding.catalogIntro}
            rows={3}
            onChange={(v) => setBranding((b) => ({ ...b, catalogIntro: v }))}
          />
        </Field>
        <Field label={de.organisation.catalogHeroImageUrl} htmlFor={id("catalog-hero")}>
          <TextInput
            id={id("catalog-hero")}
            value={branding.catalogHeroImageUrl}
            maxLength={2000}
            onChange={(v) => setBranding((b) => ({ ...b, catalogHeroImageUrl: v }))}
          />
        </Field>
        <Field
          label={de.organisation.catalogSealImageUrl}
          hint={de.organisation.catalogSealHint}
          htmlFor={id("catalog-seal")}
        >
          <TextInput
            id={id("catalog-seal")}
            value={branding.catalogSealImageUrl}
            maxLength={2000}
            onChange={(v) => setBranding((b) => ({ ...b, catalogSealImageUrl: v }))}
          />
        </Field>
        <Field label={de.organisation.catalogSealAlt} htmlFor={id("catalog-seal-alt")}>
          <TextInput
            id={id("catalog-seal-alt")}
            value={branding.catalogSealAlt}
            maxLength={200}
            onChange={(v) => setBranding((b) => ({ ...b, catalogSealAlt: v }))}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-gray-900">
          {de.organisation.privacyPolicy}
        </legend>
        <Notice tone="info">{de.organisation.privacyPolicyHint}</Notice>

        <Field label={de.organisation.privacyPolicyUrl} htmlFor={id("policy-url")}>
          <TextInput
            id={id("policy-url")}
            value={branding.privacyPolicyUrl}
            maxLength={2000}
            onChange={(v) => setBranding((b) => ({ ...b, privacyPolicyUrl: v }))}
          />
        </Field>
        <Field
          label={de.organisation.privacyPolicyVersion}
          hint={de.organisation.privacyPolicyVersionHint}
          htmlFor={id("policy-version")}
        >
          <TextInput
            id={id("policy-version")}
            value={branding.privacyPolicyVersion}
            maxLength={64}
            onChange={(v) => setBranding((b) => ({ ...b, privacyPolicyVersion: v }))}
          />
        </Field>

        {policyIncomplete ? (
          <Notice tone="warning">{de.organisation.privacyPolicyIncomplete}</Notice>
        ) : null}
      </fieldset>

      <SaveProblem title={de.error.title} problem={saver.problem} />

      <Button type="submit" disabled={saver.state === "saving" || policyIncomplete}>
        {saver.state === "saving" ? de.common.saving : de.common.save}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------

/**
 * The branding fields this form edits, as strings.
 *
 * Only the seven the contract publishes for a client to set — colours, the
 * corner radius and the uploaded font are elsewhere or server-owned. Strings
 * rather than optionals because an input's value is a string, and the empty
 * one means "unset" on the way back out.
 */
function brandingForm(project: ProjectSummary) {
  const b = (project.branding ?? {}) as Record<string, unknown>;
  const str = (key: string): string =>
    typeof b[key] === "string" ? (b[key] as string) : "";
  return {
    catalogTitle: str("catalogTitle"),
    catalogIntro: str("catalogIntro"),
    catalogHeroImageUrl: str("catalogHeroImageUrl"),
    catalogSealImageUrl: str("catalogSealImageUrl"),
    catalogSealAlt: str("catalogSealAlt"),
    privacyPolicyUrl: str("privacyPolicyUrl"),
    privacyPolicyVersion: str("privacyPolicyVersion"),
  };
}

/**
 * The whole branding object to send, blanks omitted.
 *
 * `parseBranding` stores the *parsed* result, so what is sent replaces what is
 * stored — an omitted key is a cleared value, not an untouched one. The
 * server-owned keys (`fontFamilyName`, `fontVersion`) are re-derived from the
 * project row on read, so leaving them out here cannot lose them.
 */
function brandingPayload(form: ReturnType<typeof brandingForm>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    const trimmed = value.trim();
    if (trimmed !== "") out[key] = trimmed;
  }
  return out;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * One origin per line, trimmed, blanks dropped.
 *
 * Shared by the validator and the payload so the operator is never warned about
 * a line the save then sends, or the reverse — which is the same "two readings
 * of one thing" defect as a percentage computed twice, at form scale.
 *
 * A comma-separated box was the alternative and invites a trailing comma and an
 * entry with a space in it, both of which the API refuses and neither of which
 * looks wrong on screen.
 */
function originLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
