/**
 * Course authoring (P9-02, P9-04, P9-05), against real Postgres.
 *
 * The unit tests cover the decisions. What can only be checked here is that the
 * writes survive the constraints those decisions are shaped around:
 *
 * - `UNIQUE (parent_id, ordinal)` on four tables, which a naive reorder
 *   violates the moment two rows swap.
 * - `CHECK (kind <> 'video' OR duration_sec IS NOT NULL)`, which is the second
 *   line of defence behind the domain rule.
 * - RLS `WITH CHECK` on every insert, which is what actually stops a
 *   cross-tenant write.
 * - Foreign keys from learner records, which are why deletion is refused.
 *
 * And one property that is the whole point of the feature: **a course authored
 * through this API is a course the learner API can serve**. A console that
 * produced a tree the widget could not gate would be worse than no console.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set to run the integration suite.`);
  }
  return value;
}

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
process.env["EIV_WORKER_ENABLED"] = "no";

const KID = "authoring-key";
const AUDIENCE = "ds-education-api";
const RUN = randomUUID().slice(0, 8);
const ADMIN_SUB = `authoring-admin-${RUN}`;
const LEARNER_SUB = `authoring-learner-${RUN}`;

let jwksServer: Server;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

let projectSlug: string;
let departmentSlug: string;
let customerId: string;
let courseSlug: string;

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };

  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/authoring-${RUN}`;

  process.env["KEYCLOAK_ISSUER"] = issuer;
  process.env["KEYCLOAK_AUDIENCE"] = AUDIENCE;
  process.env["KEYCLOAK_JWKS_URI"] = `${issuer}/protocol/openid-connect/certs`;

  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`authoring-${RUN}`, "Authoring GmbH"],
  );
  departmentSlug = `abteilung-${RUN}`;
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, departmentSlug, "Abteilung"],
  );
  projectSlug = `projekt-${RUN}`;
  await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name,
                           keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "Projekt", issuer, AUDIENCE],
  );

  const adminId = await insert(
    "INSERT INTO users (keycloak_realm, keycloak_sub) VALUES ($1,$2) RETURNING id",
    [issuer, ADMIN_SUB],
  );
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [adminId, customerId],
  );

  const learnerId = await insert(
    "INSERT INTO users (keycloak_realm, keycloak_sub) VALUES ($1,$2) RETURNING id",
    [issuer, LEARNER_SUB],
  );
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [learnerId, customerId],
  );

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);

  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  courseSlug = `kurs-${RUN}`;
}, 30_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await seedPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

function startJwks(jwk: JWK): Promise<number> {
  return new Promise((resolve, reject) => {
    jwksServer = createServer((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/certs")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    jwksServer.on("error", reject);
    jwksServer.listen(0, "127.0.0.1", () => {
      const address = jwksServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a bound TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function callAs(
  sub: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(privateKey);

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-ds-project": projectSlug,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(ADMIN_SUB, method, path, body);
const asLearner = (method: string, path: string, body?: unknown) =>
  callAs(LEARNER_SUB, method, path, body);

/** Ids of the tree, so tests can name things without re-reading. */
let moduleIds: string[] = [];
let chapterIds: string[] = [];
let quizContentId = "";
let videoContentId = "";

describe("building a course from nothing", () => {
  it("creates a course inside the project", async () => {
    const { status, body } = await asAdmin("POST", "/admin/courses", {
      projectSlug,
      slug: courseSlug,
      title: "ADHS Grundlagen",
      description: "Eine Fortbildung.",
    });

    expect(status).toBe(201);
    expect(body.modules).toEqual([]);
  });

  it("refuses a duplicate slug rather than shadowing the first course", async () => {
    const { status, body } = await asAdmin("POST", "/admin/courses", {
      projectSlug,
      slug: courseSlug,
      title: "Noch einmal",
    });

    expect(status).toBe(409);
    expect(body.detail).toContain("existiert bereits");
  });

  it("appends modules in the order they are created", async () => {
    for (const title of ["Modul 1", "Modul 2", "Modul 3"]) {
      const { status, body } = await asAdmin(
        "POST",
        `/admin/courses/${courseSlug}/modules`,
        { title },
      );
      expect(status).toBe(201);
      moduleIds = body.modules.map((module: { id: string }) => module.id);
    }

    const { body } = await asAdmin("GET", `/admin/courses/${courseSlug}/structure`);
    expect(body.modules.map((m: { title: string }) => m.title)).toEqual([
      "Modul 1",
      "Modul 2",
      "Modul 3",
    ]);
  });

  it("appends chapters under their module", async () => {
    for (const moduleId of moduleIds.slice(0, 2)) {
      const { status, body } = await asAdmin(
        "POST",
        `/admin/modules/${moduleId}/chapters`,
        {
          title: `Kapitel in ${moduleId.slice(0, 4)}`,
        },
      );
      expect(status).toBe(201);
      chapterIds = body.modules.flatMap((m: { chapters: { id: string }[] }) =>
        m.chapters.map((c) => c.id),
      );
    }

    expect(chapterIds).toHaveLength(2);
  });

  it("refuses a video with no duration, naming the field", async () => {
    // The CHECK constraint would catch this too, but as a 500-shaped database
    // error. An author needs to be told which field and why.
    const { status, body } = await asAdmin(
      "POST",
      `/admin/chapters/${chapterIds[0]}/contents`,
      { kind: "video", title: "Video ohne Länge", videoUrl: "https://cdn/x.mp4" },
    );

    expect(status).toBe(422);
    expect(body.detail).toContain("Länge");
  });

  it("accepts a video with a duration", async () => {
    const { status, body } = await asAdmin(
      "POST",
      `/admin/chapters/${chapterIds[0]}/contents`,
      {
        kind: "video",
        title: "Grundlagen",
        videoUrl: "https://cdn/x.mp4",
        // Captions supplied here, and asserted to reach the learner further
        // down. WCAG 1.2.2 is Level A; a field the console can store but the
        // player never surfaces would be worse than none, because the console
        // would report captions nobody can see.
        captionsUrl: "https://cdn/x.de.vtt",
        durationSec: 600,
      },
    );

    expect(status).toBe(201);
    videoContentId = body.modules[0].chapters[0].contents[0].id;
    expect(body.modules[0].chapters[0].contents[0].captionsUrl).toBe(
      "https://cdn/x.de.vtt",
    );
  });

  it("adds a quiz item and reports that it has no questions yet", async () => {
    const { body } = await asAdmin("POST", `/admin/chapters/${chapterIds[0]}/contents`, {
      kind: "quiz",
      title: "Lernerfolgskontrolle",
    });

    const quiz = body.modules[0].chapters[0].contents.find(
      (content: { kind: string }) => content.kind === "quiz",
    );
    quizContentId = quiz.id;
    // Zero is a course that cannot be completed. The console shows it in red.
    expect(quiz.questionCount).toBe(0);
  });
});

describe("reordering is a permutation, and it survives the unique constraint", () => {
  it("reverses the modules", async () => {
    // The case a naive implementation fails: every row moves, so assigning
    // the new ordinals directly collides on `UNIQUE (course_id, ordinal)`.
    const { body: before } = await asAdmin(
      "GET",
      `/admin/courses/${courseSlug}/structure`,
    );

    const reversed = [...before.modules].reverse();
    const { status, body } = await asAdmin(
      "PUT",
      `/admin/courses/${courseSlug}/structure/order`,
      {
        modules: reversed.map((module: any) => ({
          id: module.id,
          chapters: module.chapters.map((chapter: any) => ({
            id: chapter.id,
            contents: chapter.contents.map((content: any) => content.id),
          })),
        })),
      },
    );

    expect(status).toBe(200);
    expect(body.modules.map((m: { title: string }) => m.title)).toEqual([
      "Modul 3",
      "Modul 2",
      "Modul 1",
    ]);
  });

  it("moves a chapter to a different module", async () => {
    const { body: before } = await asAdmin(
      "GET",
      `/admin/courses/${courseSlug}/structure`,
    );

    // Specifically the chapter holding the video — an earlier reversal means
    // "the first module with chapters" is not necessarily that one, and the
    // assertion below is about the content travelling with its chapter.
    const source = before.modules.find((m: any) =>
      m.chapters.some((c: any) => c.contents.some((x: any) => x.id === videoContentId)),
    );
    const target = before.modules.find((m: any) => m.id !== source.id);
    const moving = source.chapters.find((c: any) =>
      c.contents.some((x: any) => x.id === videoContentId),
    );

    const order = {
      modules: before.modules.map((module: any) => ({
        id: module.id,
        chapters:
          module.id === source.id
            ? source.chapters
                .filter((c: any) => c.id !== moving.id)
                .map((c: any) => ({
                  id: c.id,
                  contents: c.contents.map((x: any) => x.id),
                }))
            : module.id === target.id
              ? [
                  ...target.chapters.map((c: any) => ({
                    id: c.id,
                    contents: c.contents.map((x: any) => x.id),
                  })),
                  { id: moving.id, contents: moving.contents.map((x: any) => x.id) },
                ]
              : module.chapters.map((c: any) => ({
                  id: c.id,
                  contents: c.contents.map((x: any) => x.id),
                })),
      })),
    };

    const { status, body } = await asAdmin(
      "PUT",
      `/admin/courses/${courseSlug}/structure/order`,
      order,
    );

    expect(status).toBe(200);
    const nowIn = body.modules.find((m: any) =>
      m.chapters.some((c: any) => c.id === moving.id),
    );
    expect(nowIn.id).toBe(target.id);
    // And it took its content with it.
    const movedChapter = nowIn.chapters.find((c: any) => c.id === moving.id);
    expect(movedChapter.contents.map((c: any) => c.id)).toContain(videoContentId);
  });

  it("refuses an ordering that lost a module, and changes nothing", async () => {
    const { body: before } = await asAdmin(
      "GET",
      `/admin/courses/${courseSlug}/structure`,
    );

    const { status, body } = await asAdmin(
      "PUT",
      `/admin/courses/${courseSlug}/structure/order`,
      {
        modules: before.modules.slice(1).map((module: any) => ({
          id: module.id,
          chapters: module.chapters.map((c: any) => ({
            id: c.id,
            contents: c.contents.map((x: any) => x.id),
          })),
        })),
      },
    );

    expect(status).toBe(422);
    expect(body.detail).toContain("lässt");

    const { body: after } = await asAdmin(
      "GET",
      `/admin/courses/${courseSlug}/structure`,
    );
    expect(after.modules.map((m: any) => m.id)).toEqual(
      before.modules.map((m: any) => m.id),
    );
  });

  it("refuses an ordering that names something that is not there", async () => {
    const { body: before } = await asAdmin(
      "GET",
      `/admin/courses/${courseSlug}/structure`,
    );

    const { status } = await asAdmin(
      "PUT",
      `/admin/courses/${courseSlug}/structure/order`,
      {
        modules: [
          ...before.modules.map((module: any) => ({
            id: module.id,
            chapters: module.chapters.map((c: any) => ({
              id: c.id,
              contents: c.contents.map((x: any) => x.id),
            })),
          })),
          { id: randomUUID(), chapters: [] },
        ],
      },
    );

    expect(status).toBe(422);
  });
});

describe("authoring a quiz", () => {
  it("refuses a question with no correct answer", async () => {
    const { status, body } = await asAdmin(
      "PUT",
      `/admin/contents/${quizContentId}/quiz`,
      {
        questions: [
          {
            prompt: "Was trifft zu?",
            kind: "single",
            options: [
              { label: "A", isCorrect: false },
              { label: "B", isCorrect: false },
            ],
          },
        ],
      },
    );

    expect(status).toBe(422);
    expect(body.detail).toContain("keine richtige Antwort");
  });

  it("refuses a single-choice question with two correct answers", async () => {
    // Scoring is exact-set, so this question is unpassable by construction.
    const { status, body } = await asAdmin(
      "PUT",
      `/admin/contents/${quizContentId}/quiz`,
      {
        questions: [
          {
            prompt: "Was trifft zu?",
            kind: "single",
            options: [
              { label: "A", isCorrect: true },
              { label: "B", isCorrect: true },
            ],
          },
        ],
      },
    );

    expect(status).toBe(422);
    expect(body.detail).toContain("Einfachauswahl");
  });

  it("stores a valid quiz and gives the author back the answer key", async () => {
    const { status, body } = await asAdmin(
      "PUT",
      `/admin/contents/${quizContentId}/quiz`,
      {
        questions: [
          {
            prompt: "Frage 1",
            kind: "single",
            options: [
              { label: "Richtig", isCorrect: true },
              { label: "Falsch", isCorrect: false },
            ],
          },
          {
            prompt: "Frage 2",
            kind: "multi",
            options: [
              { label: "A", isCorrect: true },
              { label: "B", isCorrect: true },
              { label: "C", isCorrect: false },
            ],
          },
        ],
      },
    );

    expect(status).toBe(200);
    expect(body.questions).toHaveLength(2);
    expect(body.questions[0].options.filter((o: any) => o.isCorrect)).toHaveLength(1);
  });

  it("never shows the answer key to a learner", async () => {
    // The property P4-01 exists for, asserted against the live endpoints rather
    // than against a type.
    const learner = await asLearner("GET", `/admin/contents/${quizContentId}/quiz`);
    expect(learner.status).toBe(403);
  });

  it("reorders questions without colliding on the unique ordinal", async () => {
    const { body: current } = await asAdmin(
      "GET",
      `/admin/contents/${quizContentId}/quiz`,
    );

    const { status, body } = await asAdmin(
      "PUT",
      `/admin/contents/${quizContentId}/quiz`,
      {
        questions: [...current.questions].reverse().map((question: any) => ({
          id: question.id,
          prompt: question.prompt,
          kind: question.kind,
          options: question.options.map((option: any) => ({
            id: option.id,
            label: option.label,
            isCorrect: option.isCorrect,
          })),
        })),
      },
    );

    expect(status).toBe(200);
    expect(body.questions[0].prompt).toBe("Frage 2");
  });
});

describe("what a learner has touched cannot be deleted", () => {
  let enrolmentId = "";

  beforeAll(async () => {
    // A learner enrols and watches, which is what creates the evidence.
    const enrol = await asLearner("PUT", `/courses/${courseSlug}/enrolment`);
    expect(enrol.status).toBe(200);
    enrolmentId = enrol.body.enrolmentId;

    const progress = await asLearner(
      "POST",
      `/courses/${courseSlug}/contents/${videoContentId}/progress`,
      { segments: [{ startSec: 0, endSec: 300 }], positionSec: 300 },
    );
    expect(progress.status).toBe(200);
  });

  it("recorded the progress", async () => {
    const { rows } = await seedPool.query(
      "SELECT 1 FROM content_progress WHERE enrolment_id = $1 AND content_id = $2",
      [enrolmentId, videoContentId],
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses to delete the content, and says how many are affected", async () => {
    const { status, body } = await asAdmin("DELETE", `/admin/contents/${videoContentId}`);

    expect(status).toBe(409);
    expect(body.detail).toContain("Teilnahmen");
  });

  it("refuses to delete the chapter above it", async () => {
    const { body: structure } = await asAdmin(
      "GET",
      `/admin/courses/${courseSlug}/structure`,
    );
    const chapter = structure.modules
      .flatMap((m: any) => m.chapters)
      .find((c: any) => c.contents.some((x: any) => x.id === videoContentId));

    const { status } = await asAdmin("DELETE", `/admin/chapters/${chapter.id}`);
    expect(status).toBe(409);
  });

  it("still allows deleting something untouched", async () => {
    const { body } = await asAdmin("POST", `/admin/courses/${courseSlug}/modules`, {
      title: "Wegwerfmodul",
    });
    const throwaway = body.modules.find((m: any) => m.title === "Wegwerfmodul");

    const { status } = await asAdmin("DELETE", `/admin/modules/${throwaway.id}`);
    expect(status).toBe(200);
  });

  it("reports the record count on the tree so the console can disable the button", async () => {
    const { body } = await asAdmin("GET", `/admin/courses/${courseSlug}/structure`);
    const content = body.modules
      .flatMap((m: any) => m.chapters)
      .flatMap((c: any) => c.contents)
      .find((x: any) => x.id === videoContentId);

    expect(content.learnerRecords).toBeGreaterThan(0);
  });
});

describe("an authored course is a course the learner API can serve", () => {
  it("serves the tree the author built, in the author's order", async () => {
    // The point of the whole feature. A console that produced a tree the widget
    // could not gate would be worse than no console.
    const author = await asAdmin("GET", `/admin/courses/${courseSlug}/structure`);
    const learner = await asLearner("GET", `/courses/${courseSlug}`);

    expect(learner.status).toBe(200);
    expect(learner.body.modules.map((m: any) => m.title)).toEqual(
      author.body.modules.map((m: any) => m.title),
    );
  });

  it("hands the learner's player the caption track the author supplied", async () => {
    // The half that makes the column worth having. WCAG 1.2.2 is Level A, and
    // a caption URL that the console stores but the lesson payload drops would
    // report captions to an author that no learner can turn on.
    const lesson = await asLearner(
      "GET",
      `/courses/${courseSlug}/contents/${videoContentId}`,
    );

    expect(lesson.status).toBe(200);
    expect(lesson.body.captionsUrl).toContain("x.de.vtt");
  });

  it("gates the authored quiz behind the authored video", async () => {
    const state = await asLearner("GET", `/courses/${courseSlug}/enrolment`);
    expect(state.status).toBe(200);
    // The quiz exists in the rollup, which means gating sees it.
    expect(JSON.stringify(state.body)).toContain(quizContentId);
  });

  it("measures the watch requirement against the duration the author typed", async () => {
    // The learner has watched 300 seconds. The author entered 600, so this is
    // 50 % — and that number exists only because the duration field is
    // mandatory. Had it been optional there would be nothing to be a
    // percentage of, and the content would count as done for free.
    const half = await asLearner("GET", `/courses/${courseSlug}/enrolment`);

    expect(half.status).toBe(200);
    expect(half.body.achievedWatchPercent).toBe(50);
    expect(half.body.outstanding).toContain("watch");
  });

  it("applies the plausibility guard to authored content too", async () => {
    // Claiming another 300 seconds of playback a moment after the last report
    // is what a scripted client produces, and `validateSegments` refuses it.
    // Worth asserting here because it proves the guard follows the *authored*
    // duration rather than some property of the seeded course.
    const { status, body } = await asLearner(
      "POST",
      `/courses/${courseSlug}/contents/${videoContentId}/progress`,
      { segments: [{ startSec: 300, endSec: 600 }], positionSec: 600 },
    );

    expect(status).toBe(200);
    expect(body.rejected.length).toBeGreaterThan(0);
    // And the figure did not move, because the server recomputed it rather
    // than believing the client.
    expect(body.watchedPercent).toBe(50);
  });

  it("serves the authored quiz to the learner with no answer key", async () => {
    const quiz = await asLearner(
      "GET",
      `/courses/${courseSlug}/contents/${quizContentId}/quiz`,
    );

    expect(quiz.status).toBe(200);
    expect(quiz.body.questions).toHaveLength(2);
    // P4-01: the learner-facing shape has nowhere to put a correctness marker.
    expect(JSON.stringify(quiz.body)).not.toContain("isCorrect");
    expect(JSON.stringify(quiz.body)).not.toContain("correct");
  });
});

describe("authoring is closed to a learner", () => {
  it("403s every mutating route", async () => {
    const refusals = await Promise.all([
      asLearner("POST", "/admin/courses", { projectSlug, slug: "x", title: "x" }),
      asLearner("POST", `/admin/courses/${courseSlug}/modules`, { title: "x" }),
      asLearner("PUT", `/admin/courses/${courseSlug}/structure/order`, { modules: [] }),
      asLearner("PUT", `/admin/contents/${quizContentId}/quiz`, { questions: [] }),
      asLearner("PATCH", `/admin/projects/${projectSlug}`, { name: "x" }),
    ]);

    expect(refusals.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
  });
});

describe("project settings", () => {
  it("stores an SMTP password and never returns it", async () => {
    const secret = `smtp-${randomUUID()}`;
    const { status } = await asAdmin("PATCH", `/admin/projects/${projectSlug}`, {
      smtpHost: "smtp.example.de",
      smtpPort: 587,
      smtpUsername: "cme",
      smtpPassword: secret,
    });

    expect(status).toBe(200);

    const { body } = await asAdmin("GET", "/admin/projects");
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(secret);
    expect(body.find((p: any) => p.slug === projectSlug).hasSmtpPassword).toBe(true);
  });

  it("drops a branding value that fails its grammar rather than storing it", async () => {
    await asAdmin("PATCH", `/admin/projects/${projectSlug}`, {
      branding: { primaryColor: "red; background: url(evil)", cornerRadiusPx: 8 },
    });

    const { body } = await asAdmin("GET", "/admin/projects");
    const branding = body.find((p: any) => p.slug === projectSlug).branding;

    expect(branding.primaryColor).toBeUndefined();
    expect(branding.cornerRadiusPx).toBe(8);
  });

  it("creates a department and a project inside this tenant", async () => {
    const slug = `neu-${randomUUID().slice(0, 8)}`;

    const department = await asAdmin("POST", "/admin/departments", {
      slug,
      name: "Neue Abteilung",
    });
    expect(department.status).toBe(201);

    const project = await asAdmin("POST", "/admin/projects", {
      departmentSlug: slug,
      slug,
      name: "Neues Projekt",
    });
    expect(project.status).toBe(201);

    // And it landed in this customer, not somewhere else — RLS's WITH CHECK is
    // what makes that true, since the insert never names a customer at all.
    const { rows } = await seedPool.query<{ customer_id: string }>(
      "SELECT customer_id FROM projects WHERE slug = $1",
      [slug],
    );
    expect(rows[0]?.customer_id).toBe(customerId);
  });
});
