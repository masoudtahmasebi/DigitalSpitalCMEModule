/**
 * The whole system, from an empty cluster to a certificate — over HTTP only.
 *
 * ## What this proves that the other fourteen suites do not
 *
 * Each of those is a vertical slice, and each **hand-seeds around the seam it
 * does not care about**: `learning-flow` inserts a course with SQL,
 * `authoring` inserts a learner, `completion-flow` inserts both. That is the
 * right shape for a suite that is asking one question — and it means no test
 * has ever asked whether the halves *fit together*.
 *
 * Both bugs found on the day this was written lived in exactly that gap: a
 * credential merge that read nothing because its SELECTs were tenant-scoped
 * inside a cross-tenant operation, and a widget that tore its own player down
 * on every progress flush. Neither was visible from inside a slice.
 *
 * So this suite writes **no fixture SQL at all** below the schema itself.
 * Every row it depends on is created by the product's own interfaces:
 *
 *   an empty database → roles → migrations → the first operator → a customer →
 *   a department → a project → a course → a module → a chapter → a video →
 *   a Lernerfolgskontrolle → an Evaluationsbogen → a participant account →
 *   the participant signs in → changes their password → sees the catalogue →
 *   enrols → is refused a shortcut → watches → passes → evaluates → supplies
 *   an EFN → is issued a certificate → and appears in the operator's report.
 *
 * ## Why a database of its own
 *
 * `beforeAll` creates one, applies `infra/postgres/init-roles.sql` and runs
 * every migration in order. That is the only way to test the *installation*
 * rather than the state some earlier suite left behind — and it is where a
 * missing GRANT, a migration that depends on an earlier one's data, or an
 * `init-roles.sql` that has drifted from the migrations would show up. Two of
 * those three have happened in this repository.
 *
 * The database is dropped afterwards. If a run is interrupted, a stray
 * `ds_journey_*` database is the residue; it is harmless and named so it can be
 * found.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { runMigrations } from "@ds/migrator";
import {
  EivAccreditationReporter,
  startMockServer,
  type MockServer,
} from "@ds/eiv-client";
import { PARTICIPANT_COOKIE } from "../../src/auth/participant-cookie.js";
import { signInStaff, type StaffSession } from "./support/staff-session.js";
import { requireEnv } from "./support/env.js";

const run = promisify(execFile);

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const MIGRATION_URL = requireEnv("MIGRATION_DATABASE_URL");
const APP_URL = requireEnv("DATABASE_URL");

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const DB = `ds_journey_${randomUUID().replace(/-/gu, "").slice(0, 12)}`;

/** Swap the database out of a connection string, keeping credentials and host. */
function pointAt(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

const PARTICIPANT_NEW_PASSWORD = `Neues-langes-Passwort-${randomUUID()}`;
const EFN = "123456789012345";
/**
 * Synthetic, and deliberately not the one on the ÄKWL Bescheid: a VNR names a
 * real accredited event, and a fixture that carries one can be submitted from
 * a test run by accident.
 */
const VNR = "9999999999999999999";
/**
 * The credential the Ärztekammer issues with a VNR, as an operator would type
 * it into the console. Self-describing on purpose — a realistic-looking secret
 * in a fixture is what P33-02 spent an hour clearing out of the history.
 */
const VNR_PASSWORD = "vnr-password-for-the-journey";
/** 1×1 PNG — enough to be a real image, which is what the magic-byte check
 * actually verifies. */
const PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let app: NestExpressApplication;
let baseUrl: string;
let admin: Pool;
let staff: StaffSession;

/** Set by the journey as it goes. Each step depends on the one before it. */
const world = {
  customerSlug: "",
  /** `x-ds-customer` carries an **id**, not a slug — see `auth.guard.ts`. */
  customerId: "",
  projectSlug: "",
  courseSlug: "",
  videoId: "",
  quizContentId: "",
  participantEmail: "",
  participantCookie: "",
};

beforeAll(async () => {
  // ---- an empty cluster ----------------------------------------------------
  const bootstrap = new Pool({ connectionString: pointAt(SUPERUSER_URL, "postgres") });
  await bootstrap.query(`CREATE DATABASE ${DB}`);
  await bootstrap.end();

  // ---- roles, exactly as the deploy applies them ---------------------------
  await run(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-f", `${REPO}infra/postgres/init-roles.sql`],
    { env: { ...process.env, PGDATABASE: DB, ...pgEnv(SUPERUSER_URL) } },
  );

  // ---- every migration, in order ------------------------------------------
  await runMigrations({
    connectionString: pointAt(MIGRATION_URL, DB),
    migrationsDir: `${REPO}db/migrations`,
  });

  // ---- the API, pointed at it ---------------------------------------------
  process.env["DATABASE_URL"] = pointAt(APP_URL, DB);
  process.env["MIGRATION_DATABASE_URL"] = pointAt(MIGRATION_URL, DB);
  process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
  process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
  process.env["KEYCLOAK_JWKS_URI"] ??=
    "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
  process.env["NODE_ENV"] ??= "test";
  /*
   * Real AES-GCM, not the plaintext development cipher (P34-01).
   *
   * Without this `createSecretCipher` falls back to `PlaintextSecretCipher`,
   * and the journey would prove the VNR password survives a round trip through
   * a cipher that does not encrypt. `CLAUDE.md` §4 invariant 7 is that the
   * password is encrypted at rest, and act 7 is where that is actually
   * exercised: the console writes it, the column holds ciphertext, and the
   * worker decrypts it to authenticate.
   *
   * Derived rather than pasted, and self-describing: a 32-byte base64 blob in a
   * test file is what gitleaks is for, and P33-02 is the record of what a
   * repository full of them costs.
   *
   * `Buffer.alloc(32, …)` rather than a 32-character literal: the first attempt
   * was 33 bytes, and `AesGcmSecretCipher` refused to construct — the length
   * check doing exactly what its comment promises, reported as a native stack
   * trace from Nest's initialisation. Padding to the required length cannot
   * drift.
   */
  process.env["SECRETS_KMS_KEY"] ??= Buffer.alloc(
    32,
    "ds-journey-kms-key-not-a-secret",
  ).toString("base64");
  // The two background workers stay off. This suite is about the request path,
  // and a worker that submitted a Punktemeldung mid-run would make the last
  // assertions depend on timing.
  process.env["EIV_WORKER_ENABLED"] = "no";
  process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

  const { AppModule } = await import("../../src/app.module.js");
  const { configureApp } = await import("../../src/configure-app.js");
  const { loadConfig } = await import("../../src/config/config.js");

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the HTTP server to bind a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  admin = new Pool({ connectionString: pointAt(SUPERUSER_URL, DB) });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();

  const bootstrap = new Pool({ connectionString: pointAt(SUPERUSER_URL, "postgres") });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await bootstrap.end();
});

/** `psql` reads the connection from the environment; this is that translation. */
function pgEnv(connectionString: string): Record<string, string> {
  const url = new URL(connectionString);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port === "" ? "5432" : url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

// ---------------------------------------------------------------------------
// HTTP, in the two shapes this platform has
// ---------------------------------------------------------------------------

/**
 * `RequestInit` with the headers narrowed to a plain record.
 *
 * `RequestInit["headers"]` is `HeadersInit`, which includes `Headers` and an
 * array of pairs. Intersecting rather than replacing left the property a union,
 * and spreading a union is not assignable back to a record — so the helpers
 * below could not pass their own defaults through. Only one shape is ever used
 * here, so the type says so.
 */
type Init = Omit<RequestInit, "headers"> & { headers?: Record<string, string> };

async function call(
  path: string,
  init: Init = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

/** As the signed-in operator, with the CSRF token every mutation needs. */
function asStaff(path: string, init: Init = {}) {
  return call(path, {
    ...init,
    headers: { cookie: staff.cookie, "x-ds-csrf": staff.csrf, ...init.headers },
  });
}

/** As the participant, through the project they belong to. */
function asLearner(path: string, init: Init = {}) {
  return call(path, {
    ...init,
    headers: {
      cookie: `${PARTICIPANT_COOKIE}=${world.participantCookie}`,
      "x-ds-project": world.projectSlug,
      ...init.headers,
    },
  });
}

const body = (value: unknown) => JSON.stringify(value);

// ---------------------------------------------------------------------------

describe("1 · the installation", () => {
  it("comes up with an application role that cannot escape its tenant", async () => {
    // ADR-0002's whole premise, asserted on a database created minutes ago
    // rather than assumed from a migration nobody re-runs. A `ds_app` that was
    // BYPASSRLS, or that owned a table, would have no tenant isolation at all —
    // and every isolation test in this repository would still pass, because
    // they all check queries rather than the role behind them.
    const { rows } = await admin.query<{
      bypass: boolean;
      superuser: boolean;
      owned: string;
    }>(
      `SELECT r.rolbypassrls AS bypass,
              r.rolsuper     AS superuser,
              (SELECT count(*) FROM pg_class c
                WHERE c.relowner = r.oid AND c.relkind = 'r')::text AS owned
         FROM pg_roles r WHERE r.rolname = 'ds_app'`,
    );

    expect(rows[0]).toEqual({ bypass: false, superuser: false, owned: "0" });
  });

  it("forces row-level security on every tenant-scoped table", async () => {
    // `FORCE` is the half that applies to the owner. Without it `ds_migrator`
    // — and anything running as it — reads every tenant's rows, which is how
    // P21-01's backfill silently inserted nothing and how P21-05's merge
    // silently moved nothing.
    //
    // The four exceptions are named rather than filtered out by a rule,
    // because the rule that would exclude them ("staff-plane tables") is one a
    // future table could match by accident. Carrying a `customer_id` is not
    // the same as being partitioned by `app.customer_id`: on all four it is a
    // *scope* — which customer a grant, a policy or an audit entry is about —
    // read by the staff plane, which has no tenant context at all (ADR-0012).
    //
    // A new tenant-scoped table added without FORCE fails here, which is the
    // point.
    const staffPlane = [
      "admin_2fa_policy",
      "admin_audit_log",
      "admin_user_roles",
      "user_roles",
    ];

    const { rows } = await admin.query<{ relname: string }>(
      `SELECT relname FROM pg_class
        WHERE relkind = 'r'
          AND relnamespace = 'public'::regnamespace
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = pg_class.oid
                         AND a.attname = 'customer_id'
                         AND NOT a.attisdropped)
          AND NOT relforcerowsecurity
        ORDER BY relname`,
    );

    expect(rows.map((row) => row.relname)).toEqual(staffPlane);
  });

  it("answers /health/ready once the database is reachable", async () => {
    const { status, body: payload } = await call("/health/ready");

    expect(status).toBe(200);
    expect(payload.status).toBe("ok");
  });
});

describe("2 · the first operator", () => {
  it("is created by bootstrap-admin, which prints a password exactly once", async () => {
    // The real entrypoint, run as the deploy runs it. Its refusal to run twice
    // is what makes it safe to ship in the image, and asserting the happy path
    // here is what stops that refusal being the only thing anybody tests.
    const email = `technik-${randomUUID().slice(0, 8)}@journey.test`;
    const { stdout } = await run(
      "npx",
      [
        "tsx",
        `${REPO}apps/api/src/bootstrap-admin.ts`,
        "--email",
        email,
        "--name",
        "Technik",
      ],
      { env: { ...process.env, DATABASE_URL: pointAt(SUPERUSER_URL, DB) }, cwd: REPO },
    );

    // `    Passwort  <value>` — the CLI's own format, asserted here so that a
    // change to it fails a test rather than silently breaking the one line of
    // a first deploy that nobody can recover from.
    const password = /^\s*Passwort\s+(\S+)\s*$/mu.exec(stdout)?.[1];
    expect(password, `bootstrap-admin printed no password:\n${stdout}`).toBeDefined();

    // And it refuses a second time, which is the property that matters.
    await expect(
      run(
        "npx",
        [
          "tsx",
          `${REPO}apps/api/src/bootstrap-admin.ts`,
          "--email",
          email,
          "--name",
          "Zwei",
        ],
        { env: { ...process.env, DATABASE_URL: pointAt(SUPERUSER_URL, DB) }, cwd: REPO },
      ),
    ).rejects.toThrow();

    staff = await signInStaff({ baseUrl, email, password: password as string });
    expect(staff.cookie).toContain("ds_staff_session=");
  }, 120_000);
});

describe("3 · the operator builds a course", () => {
  it("refuses a tenant header that is not an id, as a client error", async () => {
    // A slug here is the obvious mistake, and this suite made it on its first
    // run. It reached a query as a uuid and produced a **500** out of a
    // repository four layers down — the client's error reported as ours, with
    // the explanation correctly withheld from the response, leaving the caller
    // nothing to act on.
    const refused = await asStaff("/admin/departments", {
      method: "POST",
      headers: { "x-ds-customer": "not-a-uuid" },
      body: body({ slug: "abt", name: "Abteilung" }),
    });

    expect(refused.status).toBe(422);
    expect(refused.body.detail).toContain("Kunde");
  });

  it("creates a customer, a department and a project", async () => {
    const suffix = randomUUID().slice(0, 8);
    world.customerSlug = `journey-${suffix}`;
    world.projectSlug = `portal-${suffix}`;

    const customer = await asStaff("/admin/customers", {
      method: "POST",
      body: body({ slug: world.customerSlug, name: `Journey ${suffix} GmbH` }),
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    world.customerId = customer.body.id;

    // The **id**. The header carries one and needs no lookup, because
    // `staffTenantContext` answers 403 for an id this operator holds no grant
    // for whether or not it exists — so there is nothing to enumerate with.
    const scoped = { "x-ds-customer": world.customerId };

    const department = await asStaff("/admin/departments", {
      method: "POST",
      headers: scoped,
      body: body({ slug: `abt-${suffix}`, name: "Abteilung" }),
    });
    expect(department.status).toBe(201);

    const project = await asStaff("/admin/projects", {
      method: "POST",
      headers: scoped,
      body: body({
        departmentSlug: `abt-${suffix}`,
        slug: world.projectSlug,
        name: "Portal",
        identityProvider: "local",
      }),
    });
    expect(project.status, JSON.stringify(project.body)).toBe(201);
  });

  it("creates the course, its module, its chapter and a video", async () => {
    const scoped = { "x-ds-project": world.projectSlug };
    world.courseSlug = `kurs-${randomUUID().slice(0, 8)}`;

    const course = await asStaff("/admin/courses", {
      method: "POST",
      headers: scoped,
      body: body({
        projectSlug: world.projectSlug,
        slug: world.courseSlug,
        title: "Journey – Diagnostik und Therapie",
      }),
    });
    expect(course.status, JSON.stringify(course.body)).toBe(201);

    const module = await asStaff(`/admin/courses/${world.courseSlug}/modules`, {
      method: "POST",
      headers: scoped,
      body: body({
        title: "Modul 1 – Grundlagen",
        subtitle: "Definition · Epidemiologie",
      }),
    });
    expect(module.status).toBe(201);
    const moduleId = module.body.modules[0].id;

    const chapter = await asStaff(`/admin/modules/${moduleId}/chapters`, {
      method: "POST",
      headers: scoped,
      body: body({ title: "Kapitel 1 – Leitlinien" }),
    });
    expect(chapter.status).toBe(201);
    const chapterId = chapter.body.modules[0].chapters[0].id;

    // A video with no duration is refused, because the watch requirement is a
    // percentage of a known length and a video without one would be skippable
    // while appearing to count toward a CME point.
    const noDuration = await asStaff(`/admin/chapters/${chapterId}/contents`, {
      method: "POST",
      headers: scoped,
      body: body({
        kind: "video",
        title: "Ohne Länge",
        sources: [{ url: "https://media.invalid/v.mp4", mimeType: "video/mp4" }],
      }),
    });
    expect(noDuration.status).toBe(422);

    const video = await asStaff(`/admin/chapters/${chapterId}/contents`, {
      method: "POST",
      headers: scoped,
      body: body({
        kind: "video",
        title: "Video 1",
        durationSec: 600,
        sources: [{ url: "https://media.invalid/v.mp4", mimeType: "video/mp4" }],
      }),
    });
    expect(video.status, JSON.stringify(video.body)).toBe(201);

    const quiz = await asStaff(`/admin/chapters/${chapterId}/contents`, {
      method: "POST",
      headers: scoped,
      body: body({ kind: "quiz", title: "Lernerfolgskontrolle" }),
    });
    expect(quiz.status).toBe(201);

    const contents = quiz.body.modules[0].chapters[0].contents as Array<{
      id: string;
      kind: string;
    }>;
    world.videoId = contents.find((c) => c.kind === "video")!.id;
    world.quizContentId = contents.find((c) => c.kind === "quiz")!.id;
  });

  it("refuses a quiz question nobody could answer correctly", async () => {
    const scoped = { "x-ds-project": world.projectSlug };

    const noCorrect = await asStaff(`/admin/contents/${world.quizContentId}/quiz`, {
      method: "PUT",
      headers: scoped,
      body: body({
        questions: [
          {
            prompt: "Eine Frage ohne richtige Antwort?",
            kind: "single",
            options: [
              { label: "A", isCorrect: false },
              { label: "B", isCorrect: false },
            ],
          },
        ],
      }),
    });

    expect(noCorrect.status).toBe(422);
  });

  it("sets a quiz, an evaluation and the accreditation", async () => {
    const scoped = { "x-ds-project": world.projectSlug };

    const quiz = await asStaff(`/admin/contents/${world.quizContentId}/quiz`, {
      method: "PUT",
      headers: scoped,
      body: body({
        questions: [1, 2, 3, 4].map((n) => ({
          prompt: `Frage ${n}?`,
          kind: "single",
          options: [
            { label: "Richtig", isCorrect: true },
            { label: "Falsch", isCorrect: false },
          ],
        })),
      }),
    });
    expect(quiz.status, JSON.stringify(quiz.body)).toBe(200);

    const evaluation = await asStaff(`/admin/courses/${world.courseSlug}/evaluation`, {
      method: "PUT",
      headers: scoped,
      body: body({
        questions: [
          { prompt: "Wie bewerten Sie die Fortbildung?", kind: "scale", required: true },
        ],
      }),
    });
    expect(evaluation.status).toBe(200);

    const settings = await asStaff(`/admin/courses/${world.courseSlug}`, {
      method: "PATCH",
      headers: scoped,
      body: body({
        cmePoints: 4,
        cmeCategory: "D",
        // Synthetic. A real VNR identifies a real accredited event at a real
        // Ärztekammer and does not belong in a fixture.
        //
        // Both fields, because they are two different things: `vnr` is what the
        // Punktemeldung is credited against and never leaves the server, and
        // `fortbildungsnummer` is what the Zertifizierung tab prints. This
        // course sets them to the same value the way a real one usually does.
        vnr: VNR,
        fortbildungsnummer: VNR,
        accreditationBody: "Ärztekammer Westfalen-Lippe",
        organizer: "Journey GmbH",
        eventLocation: "online",
        scientificLeadName: "Dr. Journey",
        certificateIssuePlace: "Münster",
        requiredWatchPercent: 80,
        passThresholdPercent: 70,
      }),
    });
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    // The VNR specifically, read back. It was settable nowhere until P26-01,
    // and a course without one completes, certifies, and reports nothing.
    expect(settings.body.vnr).toBe(VNR);
  });

  /**
   * Without these the course is authored, accredited and unusable: the PDF
   * endpoint answers 409, because the Bescheid makes a Teilnahmebescheinigung
   * without the Wissenschaftliche Leitung's stamp and signature invalid and
   * issuing one anyway would be worse than issuing none.
   *
   * It is part of the operator's job, so it is part of the journey.
   */
  it("uploads the stamp and signature the Bescheid requires", async () => {
    const assets = await asStaff(
      `/admin/courses/${world.courseSlug}/certificate-assets`,
      {
        method: "PUT",
        headers: { "x-ds-project": world.projectSlug },
        body: body({
          stampImageBase64: PLACEHOLDER_PNG,
          stampImageMime: "image/png",
          signatureImageBase64: PLACEHOLDER_PNG,
          signatureImageMime: "image/png",
        }),
      },
    );
    expect(assets.status, JSON.stringify(assets.body)).toBe(200);
    expect(assets.body.hasStampImage).toBe(true);
    expect(assets.body.hasSignatureImage).toBe(true);
    // Write-only, per CLAUDE.md §4 invariant 7 — what went up does not come
    // back down, under any key.
    expect(JSON.stringify(assets.body)).not.toContain(PLACEHOLDER_PNG);
  });
});

describe("4 · the operator creates a participant", () => {
  it("returns the one and only copy of a temporary password", async () => {
    world.participantEmail = `arzt-${randomUUID().slice(0, 8)}@journey.test`;

    const created = await asStaff("/admin/participants", {
      method: "POST",
      headers: { "x-ds-project": world.projectSlug },
      body: body({
        email: world.participantEmail,
        firstName: "Anna",
        lastName: "Schmidt",
      }),
    });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.temporaryPassword).toBeTypeOf("string");

    // One sign-in, and both the status and the cookie read off the same
    // response. Two calls with the same credential is how a test starts
    // fighting the sign-in rate limiter it did not mean to exercise.
    const signIn = await fetch(`${baseUrl}/auth/participant/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ds-project": world.projectSlug },
      body: body({
        email: world.participantEmail,
        password: created.body.temporaryPassword,
      }),
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);

    world.participantCookie =
      signIn.headers
        .getSetCookie()
        .find((c) => c.startsWith(`${PARTICIPANT_COOKIE}=`))
        ?.split(";")[0]
        ?.split("=")[1] ?? "";
    expect(world.participantCookie).not.toBe("");
  });

  it("demands a password of their own before anything else", async () => {
    // Every account an administrator creates carries `must_change`, and the
    // portal blocks on it. Re-derived from the API rather than remembered by
    // the page, so a reload cannot skip it.
    const me = await asLearner("/auth/participant/me");
    expect(me.body.mustChangePassword).toBe(true);

    const changed = await asLearner("/auth/participant/password", {
      method: "POST",
      body: body({
        currentPassword: "wrong-on-purpose",
        newPassword: PARTICIPANT_NEW_PASSWORD,
      }),
    });
    expect(changed.status).toBe(401);
  });
});

describe("5 · the participant earns the point", () => {
  it("sees the course in the catalogue", async () => {
    const catalogue = await asLearner("/courses");

    expect(catalogue.status).toBe(200);
    expect(catalogue.body.items.map((item: { slug: string }) => item.slug)).toContain(
      world.courseSlug,
    );
  });

  it("is refused a completion before anything is outstanding-free", async () => {
    await asLearner(`/courses/${world.courseSlug}/enrolment`, { method: "PUT" });

    const early = await asLearner(`/courses/${world.courseSlug}/completion`, {
      method: "POST",
      body: body({
        attestedGivenName: "Anna",
        attestedFamilyName: "Schmidt",
        efn: EFN,
      }),
    });

    expect(early.status).toBe(409);
  });

  it("watches the video, and the union is what counts", async () => {
    // Sent as overlapping fragments, out of order, as a real player does. A
    // maximum-position implementation would credit 600 s from the last one
    // alone; the union credits what was actually seen.
    //
    // One request, not three. The wall-clock budget (`faster_than_wallclock`)
    // is measured from the *previous* report, so three back-to-back requests
    // give the second and third a budget of nearly zero and they are rightly
    // refused. The first report on a content gets the video's own duration,
    // which is what a real first flush of a player's buffer gets too.
    const sent = await asLearner(
      `/courses/${world.courseSlug}/contents/${world.videoId}/progress`,
      {
        method: "POST",
        body: body({
          segments: [
            { startSec: 0, endSec: 200 },
            { startSec: 150, endSec: 360 },
            { startSec: 340, endSec: 500 },
          ],
        }),
      },
    );
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.rejected).toEqual([]);
    // The merged union, from the server: three overlapping reports, one
    // interval back.
    expect(sent.body.watchedSegments).toEqual([{ startSec: 0, endSec: 500 }]);

    const state = await asLearner(`/courses/${world.courseSlug}/enrolment`);
    // 0–500 of 600 is 83 %, over the 80 % this course requires.
    expect(state.body.achievedWatchPercent).toBe(83);
  });

  it("cannot assert a watch percentage — only intervals it actually sends", async () => {
    // The client is a renderer. There is no field on this endpoint through
    // which a percentage could be claimed, and the union is computed from the
    // segments server-side (CLAUDE.md §4 invariants 1 and 5). An unknown
    // property is ignored rather than honoured, and the number does not move.
    const claimed = await asLearner(
      `/courses/${world.courseSlug}/contents/${world.videoId}/progress`,
      { method: "POST", body: body({ segments: [], watchedPercent: 100 }) },
    );
    expect(claimed.status).toBe(200);

    const state = await asLearner(`/courses/${world.courseSlug}/enrolment`);
    expect(state.body.achievedWatchPercent).toBe(83);
  });

  it("fails the quiz, then passes it — and is never shown the answer key", async () => {
    const quizPath = `/courses/${world.courseSlug}/contents/${world.quizContentId}/quiz`;
    const quiz = await asLearner(quizPath);
    expect(quiz.status).toBe(200);
    expect(JSON.stringify(quiz.body)).not.toContain("isCorrect");

    const questions = quiz.body.questions as Array<{
      id: string;
      options: Array<{ id: string; label: string }>;
    }>;

    const answersLabelled = (label: string) =>
      questions.map((question) => ({
        questionId: question.id,
        selectedOptionIds: [question.options.find((o) => o.label === label)!.id],
      }));

    const wrong = await asLearner(quizPath, {
      method: "POST",
      body: body({ answers: answersLabelled("Falsch") }),
    });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(200);
    expect(wrong.body.passed).toBe(false);
    // Not "no `perQuestion` field": nothing anywhere in the response says which
    // question was wrong. `revealCorrectAnswers` is off, and a CME course never
    // turns it on — an answer key returned on a failed attempt is the whole
    // Lernerfolgskontrolle handed over for the price of one wrong sitting.
    expect(JSON.stringify(wrong.body)).not.toContain(questions[0]!.id);

    const right = await asLearner(quizPath, {
      method: "POST",
      body: body({ answers: answersLabelled("Richtig") }),
    });
    expect(right.status, JSON.stringify(right.body)).toBe(200);
    expect(right.body.passed).toBe(true);
    expect(right.body.attemptNumber).toBe(2);
    expect(right.body.scorePercent).toBe(100);
  });

  it("submits the evaluation and completes with an EFN", async () => {
    const evaluation = await asLearner(`/courses/${world.courseSlug}/evaluation`);
    expect(evaluation.body.submitted).toBe(false);
    const answers = (evaluation.body.questions as Array<{ id: string }>).map(
      (question) => ({ evaluationId: question.id, answer: "5" }),
    );

    const submitted = await asLearner(`/courses/${world.courseSlug}/evaluation`, {
      method: "POST",
      body: body({ answers }),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

    const completed = await asLearner(`/courses/${world.courseSlug}/completion`, {
      method: "POST",
      body: body({
        attestedGivenName: "Anna",
        attestedFamilyName: "Schmidt",
        attestedTitle: "Dr. med.",
        efn: EFN,
      }),
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);

    const state = await asLearner(`/courses/${world.courseSlug}/enrolment`);
    expect(state.body.complete).toBe(true);
    expect(state.body.outstanding).toEqual([]);
  });

  it("never sees its own EFN come back", async () => {
    // ADR-0004: no endpoint returns one. The completion accepted it and the
    // state says it is on file, and that is all a learner is ever told.
    const state = await asLearner(`/courses/${world.courseSlug}/enrolment`);

    expect(state.body.efnPresent).toBe(true);
    expect(JSON.stringify(state.body)).not.toContain(EFN);
  });

  it("is issued a certificate, and it is a real PDF", async () => {
    const data = await asLearner(`/courses/${world.courseSlug}/certificate`);
    expect(data.status, JSON.stringify(data.body)).toBe(200);
    expect(data.body.participantName).toBe("Dr. med. Anna Schmidt");

    const pdf = await fetch(`${baseUrl}/courses/${world.courseSlug}/certificate/pdf`, {
      headers: {
        cookie: `${PARTICIPANT_COOKIE}=${world.participantCookie}`,
        "x-ds-project": world.projectSlug,
      },
    });
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it("queues exactly one Punktemeldung", async () => {
    const { rows } = await admin.query<{ status: string; n: string }>(
      `SELECT status, count(*)::text AS n FROM eiv_submissions GROUP BY status`,
    );

    expect(rows).toEqual([{ status: "queued", n: "1" }]);
  });
});

describe("6 · the operator sees it", () => {
  it("reports the participation, and exports it as CSV", async () => {
    const scoped = { "x-ds-project": world.projectSlug };

    const report = await asStaff(`/admin/courses/${world.courseSlug}/participants`, {
      headers: scoped,
    });
    expect(report.status).toBe(200);
    expect(report.body.rows).toHaveLength(1);

    const row = report.body.rows[0];
    expect(row.completedAt).not.toBeNull();
    expect(row.participantName).toBe("Dr. med. Anna Schmidt");
    // Invariant 6: the operator's number and the learner's number come from
    // the same rollup. 83 is what the learner's own enrolment screen said.
    expect(row.watchedPercent).toBe(83);
    expect(row.quizPassed).toBe(true);
    expect(row.evaluationSubmitted).toBe(true);
    expect(row.complete).toBe(true);
    // ADR-0004: on file, never returned.
    expect(row.efnPresent).toBe(true);
    expect(JSON.stringify(report.body)).not.toContain(EFN);

    const csv = await fetch(
      `${baseUrl}/admin/courses/${world.courseSlug}/participants.csv`,
      { headers: { cookie: staff.cookie, ...scoped } },
    );
    expect(csv.status).toBe(200);
    const text = await csv.text();
    expect(text).toContain("Schmidt");
    // The export is a participation record, not a credential dump.
    expect(text).not.toContain(EFN);
  });
});

/**
 * 7 · The Punktemeldung actually leaves (P34-01).
 *
 * Until this act the journey stopped at `queued` — it proved the platform
 * *decides* to report, and nothing more. Everything between that decision and
 * the Ärztekammer was covered only by `eiv-worker.integration.test.ts`, which
 * inserts its fixture course with `INSERT INTO courses (…, vnr_password_enc)`
 * directly.
 *
 * That gap is exactly where a real installation fails, and this session found
 * it the expensive way: an environment was configured with `EIV_VNR_PASSWORD`
 * in `config.env`, where nothing reads it, because the password belongs to the
 * *course*. Under that configuration every completion is abandoned
 * `missing_vnr_password` — permanently, one row at a time, inside an 8-day
 * statutory window.
 *
 * So this act walks the path an operator walks: set the password on the course
 * through the console's write-only field, confirm the API never gives it back,
 * and let the worker take it from there.
 */
describe("7 · the Punktemeldung reaches the Ärztekammer", () => {
  let kammer: MockServer;

  beforeAll(async () => {
    kammer = await startMockServer(0);
  });

  afterAll(async () => {
    await kammer?.close();
  });

  it("refuses to report while the course has no VNR password", async () => {
    // The state the course is in after act 3: accredited, with a VNR, and no
    // credential to authenticate with. The worker must not treat that as a
    // transport problem and retry it forever.
    const abandoned = await sweep();

    expect(abandoned).toMatchObject({ abandoned: 1, submitted: 0 });

    const { rows } = await admin.query<{ status: string; last_error: string }>(
      "SELECT status, last_error FROM eiv_submissions",
    );
    expect(rows[0]).toMatchObject({
      status: "failed_permanent",
      last_error: "missing_vnr_password",
    });
  });

  it("takes the password through the console, and never hands it back", async () => {
    const response = await asStaff(`/admin/courses/${world.courseSlug}`, {
      method: "PATCH",
      headers: { "x-ds-project": world.projectSlug },
      body: body({ vnrPassword: VNR_PASSWORD }),
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    // Invariant 7: write-only. Not in this response, not in the read.
    expect(JSON.stringify(response.body)).not.toContain(VNR_PASSWORD);

    const readBack = await asStaff(`/admin/courses/${world.courseSlug}`, {
      headers: { "x-ds-project": world.projectSlug },
    });
    expect(JSON.stringify(readBack.body)).not.toContain(VNR_PASSWORD);
  });

  it("stores it as ciphertext, not as a password in a column", async () => {
    const { rows } = await admin.query<{ enc: Buffer }>(
      "SELECT vnr_password_enc AS enc FROM courses WHERE slug = $1",
      [world.courseSlug],
    );

    const stored = rows[0]?.enc;
    expect(stored).toBeInstanceOf(Buffer);
    // AES-GCM, because the journey runs with a real SECRETS_KMS_KEY. The
    // plaintext must not appear anywhere in the bytes — which is the assertion
    // that would have failed had the fallback plaintext cipher been in use.
    expect(stored?.toString("latin1")).not.toContain(VNR_PASSWORD);
    expect(stored?.byteLength).toBeGreaterThan(VNR_PASSWORD.length);
  });

  it("submits the participation, shaped as the real interface requires", async () => {
    // The operator noticed and requeued, which is the P31-02 endpoint doing the
    // job it was built for. The id is read back rather than carried in `world`:
    // there is exactly one enrolment in this database, and the point of the
    // assertion is the requeue, not the bookkeeping.
    const { rows: enrolments } = await admin.query<{ id: string }>(
      "SELECT id FROM enrolments",
    );
    const enrolmentId = enrolments[0]?.id;
    expect(enrolmentId).toBeDefined();

    const requeued = await asStaff(`/admin/learners/${enrolmentId}/eiv`, {
      method: "POST",
      headers: { "x-ds-project": world.projectSlug },
    });
    expect(requeued.status, JSON.stringify(requeued.body)).toBe(204);

    expect(await sweep()).toMatchObject({ considered: 1, submitted: 1 });

    const meldung = kammer.submissions.at(-1);
    expect(meldung?.efn).toBe(EFN);
    expect(meldung?.punkteBasisFlag).toBe(1);
    expect(meldung?.punkteLernerfolgFlag).toBe(1);
    // A German calendar date. EIV refuses one outside the accredited period.
    expect(meldung?.teilnahmedatum).toMatch(/^\d{4}-\d{2}-\d{2}$/u);

    const { rows } = await admin.query<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM eiv_submissions",
    );
    /*
     * One attempt, not two, and the difference is a deliberate design decision
     * rather than an off-by-one.
     *
     * `abandon` takes `attemptCount = row.attemptCount` by default, so being
     * abandoned for a missing password does **not** spend a retry — the unit
     * test calls this "abandons rather than burning the budget". The course was
     * misconfigured; the Ärztekammer was never asked. So when the operator
     * fixes it, the submission still has its whole retry budget for the
     * failures that are actually EIV's.
     */
    expect(rows[0]).toMatchObject({ status: "submitted", attempt_count: 1 });
  });

  it("leaves no EFN and no VNR password anywhere in the audit trail", async () => {
    const { rows } = await admin.query<{ blob: string }>(
      "SELECT coalesce(string_agg(detail::text, ' '), '') AS blob FROM audit_log",
    );

    const blob = rows[0]?.blob ?? "";
    expect(blob).not.toContain(EFN);
    expect(blob).not.toContain(VNR_PASSWORD);
  });

  /**
   * One sweep of the real worker, wired the way `EivScheduler` wires it.
   *
   * Constructed here rather than left to the scheduler because the scheduler is
   * off for this suite: a background timer firing mid-run would make every
   * assertion above depend on when it happened to tick.
   */
  async function sweep() {
    const { EivService } = await import("../../src/modules/eiv/eiv.service.js");
    const { EivRepository } = await import("../../src/modules/eiv/eiv.repository.js");
    const { AuditService } = await import("../../src/audit/audit.service.js");
    const { createSecretCipher } = await import("../../src/shared/secret-cipher.js");

    const pool = new Pool({ connectionString: pointAt(APP_URL, DB) });
    try {
      const service = new EivService(
        new EivRepository(
          pool,
          createSecretCipher("test", process.env["SECRETS_KMS_KEY"]),
        ),
        new EivAccreditationReporter(),
        new AuditService(pool),
        { baseUrl: kammer.url, batchSize: 25, allowLive: false, leaseSeconds: 120 },
      );
      return await service.sweep(new Date());
    } finally {
      await pool.end();
    }
  }
});
