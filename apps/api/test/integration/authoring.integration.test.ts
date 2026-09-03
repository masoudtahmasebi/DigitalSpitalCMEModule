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
import { expectNoAnswerKey } from "../support/answer-leak.js";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";
import { backdateLearnerClock } from "./support/backdate.js";

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
  seedPool = createPool({ connectionString: SUPERUSER_URL });

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

  const { id: adminId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: ADMIN_SUB,
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [adminId, customerId],
  );

  const { id: learnerId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: LEARNER_SUB,
  });
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
      {
        kind: "video",
        title: "Video ohne Länge",
        sources: [{ url: "https://cdn/x.mp4", mimeType: "video/mp4" }],
      },
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
        sources: [{ url: "https://cdn/x.mp4", mimeType: "video/mp4" }],
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

  it("refuses a second Lernerfolgskontrolle in the same module, naming it", async () => {
    /*
     * P87-06. One exam per module is what the gate, the player's tab and the
     * completion arithmetic can express; a second is a shape none of them can.
     * `findQuizContent` would offer whichever came first, the other would be
     * unreachable from the player, and `hasPassedQuiz` would still require both
     * — so the course could not be completed at all.
     *
     * Accepted-and-ignored is exactly how P87-01 arose one level up, which is
     * why this is refused at the point the author can still act on it, rather
     * than discovered by a physician who cannot finish.
     */
    const { status, body } = await asAdmin(
      "POST",
      `/admin/chapters/${chapterIds[0]}/contents`,
      { kind: "quiz", title: "Zweite Lernerfolgskontrolle" },
    );

    expect(status).toBe(422);
    // Names the module the author has to go and look at, and no ids (§9.5).
    expect(body.detail).toContain("Lernerfolgskontrolle");
    expect(body.detail).not.toContain(quizContentId);
  });

  it("allows one in a different module — the control for the refusal above", async () => {
    /*
     * Without this, the assertion above would be green on an API that refused
     * every quiz (§9.1). `chapterIds[1]` is in the second module, so its own
     * exam is a different module's and must be accepted.
     */
    const { status } = await asAdmin(
      "POST",
      `/admin/chapters/${chapterIds[1]}/contents`,
      { kind: "quiz", title: "Lernerfolgskontrolle des zweiten Moduls" },
    );

    expect(status).toBe(201);
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

/*
 * Editing a Lernerfolgskontrolle a physician has already sat (P114-01).
 *
 * The report: *"this lernerfolgskontrolle has 11 questions, I want to make it
 * to only 2 questions and i can not."* Every answered question refused
 * deletion, so a single attempt froze the exam permanently.
 *
 * These run against a real Postgres because the properties are all about what
 * survives a write, and the one that matters most — an already-scored attempt
 * keeps its result — is a claim about rows the API never returns.
 */
describe("what a learner has touched cannot be deleted", () => {
  let enrolmentId = "";

  beforeAll(async () => {
    /*
     * Publish it first, and check that it needed publishing (P53-01).
     *
     * Everything above this point was authored against a draft — created that
     * way, invisible to learners the whole time — so the enrol below is a 404
     * until an operator publishes. The refusal is asserted rather than assumed
     * because this is the only place in the suite where the draft state has an
     * observable consequence, and a bare `PATCH` here would leave the platform
     * this ticket fixes passing the whole file (CLAUDE.md §9.1).
     */
    const early = await asLearner("PUT", `/courses/${courseSlug}/enrolment`);
    expect(early.status).toBe(404);

    const published = await asAdmin("PATCH", `/admin/courses/${courseSlug}`, {
      status: "published",
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    // A learner enrols and watches, which is what creates the evidence.
    const enrol = await asLearner("PUT", `/courses/${courseSlug}/enrolment`);
    expect(enrol.status).toBe(200);

    // …over a plausible stretch of time. The playback guard measures from the
    // learner's last activity (P55-01) and this suite takes milliseconds.
    await backdateLearnerClock(seedPool, 3600);
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

/*
 * P162-01. The three deletes that answered 500.
 *
 * `deletionVerdict` in @ds/domain asks two questions per level — is anything
 * inside it, and has any learner touched anything inside it — and the
 * repository's own comment says the levels match it. Three of the six call
 * sites only ever asked the second: `deleteModule`, `deleteChapter` and
 * `deleteContent` counted `content_progress` and never counted their children,
 * so a non-empty one reached Postgres and hit `ON DELETE RESTRICT`. An
 * unhandled foreign-key violation is a 500, which is the console offering a
 * button whose only possible outcome is an internal error (§9.2).
 *
 * The reason this was invisible: the one module-delete case in this file
 * creates a module and deletes it in the next line, so it is always empty. The
 * one chapter case is refused for *learner records* before children are ever
 * reached. Neither could have gone red.
 *
 * Everything here is built fresh and untouched by any learner, so learner
 * records cannot be the reason for any refusal below.
 */
describe("a level that still has something inside it refuses, rather than failing", () => {
  let moduleId = "";
  let chapterId = "";
  let quizId = "";

  beforeAll(async () => {
    const created = await asAdmin("POST", `/admin/courses/${courseSlug}/modules`, {
      title: "P162 Modul",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    moduleId = created.body.modules.find((m: any) => m.title === "P162 Modul").id;

    const chapter = await asAdmin("POST", `/admin/modules/${moduleId}/chapters`, {
      title: "P162 Kapitel",
    });
    expect(chapter.status, JSON.stringify(chapter.body)).toBe(201);
    chapterId = chapter.body.modules
      .find((m: any) => m.id === moduleId)
      .chapters.find((c: any) => c.title === "P162 Kapitel").id;

    const quiz = await asAdmin("POST", `/admin/chapters/${chapterId}/contents`, {
      kind: "quiz",
      title: "P162 Lernerfolgskontrolle",
    });
    expect(quiz.status, JSON.stringify(quiz.body)).toBe(201);
    quizId = quiz.body.modules
      .flatMap((m: any) => m.chapters)
      .flatMap((c: any) => c.contents)
      .find((x: any) => x.title === "P162 Lernerfolgskontrolle").id;

    const questions = await asAdmin("PUT", `/admin/contents/${quizId}/quiz`, {
      questions: [
        {
          prompt: "P162?",
          kind: "single",
          options: [
            { label: "A", isCorrect: true },
            { label: "B", isCorrect: false },
          ],
        },
      ],
    });
    expect(questions.status, JSON.stringify(questions.body)).toBe(200);
  });

  it("refuses a module that still holds a chapter, and names what is in the way", async () => {
    const { status, body } = await asAdmin("DELETE", `/admin/modules/${moduleId}`);

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.detail).toContain("Kapitel");
  });

  it("refuses a chapter that still holds a content", async () => {
    const { status, body } = await asAdmin("DELETE", `/admin/chapters/${chapterId}`);

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.detail).toContain("Inhalte");
  });

  it("refuses a Lernerfolgskontrolle that still holds questions", async () => {
    const { status, body } = await asAdmin("DELETE", `/admin/contents/${quizId}`);

    expect(status, JSON.stringify(body)).toBe(409);
    expect(body.detail).toContain("Fragen");
  });

  it("refuses a content whose only trace is a quiz attempt (P176-03)", async () => {
    /*
     * The third foreign key. `contents` is referenced with ON DELETE RESTRICT
     * by `content_progress`, `quiz_questions` **and** `quiz_attempts`; P162-01
     * guarded the first two, and the only reason the third was not a 500 is an
     * invariant nothing enforces — `submit` writes an attempt and a progress row
     * together, so the progress row was always there to be counted.
     *
     * Written directly in SQL because the API cannot produce this state, which
     * is the point: the guard must hold on the schema's terms, not on the happy
     * path's. Without the fix this DELETE reaches Postgres and comes back a 500.
     */
    // Its own module: a module may hold one Lernerfolgskontrolle (P87-06), and
    // this describe's fixture has already used the one on `moduleId`.
    const ownModule = await asAdmin("POST", `/admin/courses/${courseSlug}/modules`, {
      title: "P176 Modul",
    });
    expect(ownModule.status, JSON.stringify(ownModule.body)).toBe(201);
    const ownModuleId = ownModule.body.modules.find(
      (m: any) => m.title === "P176 Modul",
    ).id;

    const ownChapter = await asAdmin("POST", `/admin/modules/${ownModuleId}/chapters`, {
      title: "P176 Kapitel",
    });
    expect(ownChapter.status, JSON.stringify(ownChapter.body)).toBe(201);
    const ownChapterId = ownChapter.body.modules
      .find((m: any) => m.id === ownModuleId)
      .chapters.find((c: any) => c.title === "P176 Kapitel").id;

    const attemptQuiz = await asAdmin(
      "POST",
      `/admin/chapters/${ownChapterId}/contents`,
      {
        kind: "quiz",
        title: "P176 Lernerfolgskontrolle",
      },
    );
    expect(attemptQuiz.status, JSON.stringify(attemptQuiz.body)).toBe(201);
    const attemptQuizId = attemptQuiz.body.modules
      .flatMap((m: any) => m.chapters)
      .flatMap((c: any) => c.contents)
      .find((x: any) => x.title === "P176 Lernerfolgskontrolle").id;

    /*
     * An enrolment **on this course**, not `enrolments LIMIT 1`.
     *
     * The first version took any enrolment, and CI found what a local run did
     * not: the row it picked belonged to another customer, so the census —
     * which reads through the tenant-scoped connection, correctly — could not
     * see the attempt, counted zero, and let the delete reach Postgres. The 500
     * in that CI log is this fixture's, not the product's.
     *
     * CLAUDE.md §9.6 in a test rather than in a repository: a row RLS hides
     * looks exactly like a row that is not there. A cross-tenant attempt is
     * also a state production cannot reach — an attempt is always written in
     * its enrolment's tenant — so asserting against one proves nothing about
     * the guard.
     */
    const { rows } = await seedPool.query<{ id: string }>(
      `SELECT e.id
         FROM enrolments e
         JOIN courses c ON c.id = e.course_id
        WHERE c.slug = $1
        ORDER BY e.created_at
        LIMIT 1`,
      [courseSlug],
    );
    const enrolmentId = rows[0]?.id;
    expect(
      enrolmentId,
      "this course needs an enrolment of its own to hang an attempt on",
    ).toBeDefined();

    await seedPool.query(
      `INSERT INTO quiz_attempts
         (customer_id, enrolment_id, content_id, attempt_number,
          correct_count, total_count, score_percent, passed)
       SELECT e.customer_id, e.id, $2, 1, 1, 1, 100, true
         FROM enrolments e WHERE e.id = $1`,
      [enrolmentId, attemptQuizId],
    );

    const { status, body } = await asAdmin("DELETE", `/admin/contents/${attemptQuizId}`);

    expect(status, JSON.stringify(body)).toBe(409);

    await seedPool.query(`DELETE FROM quiz_attempts WHERE content_id = $1`, [
      attemptQuizId,
    ]);
    expect((await asAdmin("DELETE", `/admin/contents/${attemptQuizId}`)).status).toBe(
      200,
    );
  });

  it("deletes each of them once it is empty, innermost first", async () => {
    const emptied = await asAdmin("PUT", `/admin/contents/${quizId}/quiz`, {
      questions: [],
    });
    expect(emptied.status, JSON.stringify(emptied.body)).toBe(200);

    expect((await asAdmin("DELETE", `/admin/contents/${quizId}`)).status).toBe(200);
    expect((await asAdmin("DELETE", `/admin/chapters/${chapterId}`)).status).toBe(200);
    expect((await asAdmin("DELETE", `/admin/modules/${moduleId}`)).status).toBe(200);
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

  it("holds the authored quiz shut while the module is half watched", async () => {
    /*
     * P87-04, on a course built through the console rather than seeded — which
     * is the point of this file. The learner above is at 50 % of the authored
     * 600 seconds, so this module is not finished and its Lernerfolgskontrolle
     * is not open.
     *
     * It ran green here for as long as content simply inherited its chapter's
     * gate: the video and the quiz shared a chapter, so the exam was reachable
     * from the moment the course was.
     */
    const early = await asLearner(
      "GET",
      `/courses/${courseSlug}/contents/${quizContentId}/quiz`,
    );

    expect(early.status).toBe(403);
    expect(early.body.detail).toContain("Videos dieses Moduls");
  });

  it("serves the authored quiz to the learner with no answer key", async () => {
    // The rest of the video, on a clock that allows it — see P55-01 for why the
    // wall-clock budget has to move as well as the segments.
    await backdateLearnerClock(seedPool, 3600);
    const watched = await asLearner(
      "POST",
      `/courses/${courseSlug}/contents/${videoContentId}/progress`,
      { segments: [{ startSec: 300, endSec: 600 }], positionSec: 600 },
    );
    expect(watched.body.watchedPercent).toBe(100);

    const quiz = await asLearner(
      "GET",
      `/courses/${courseSlug}/contents/${quizContentId}/quiz`,
    );

    expect(quiz.status).toBe(200);
    expect(quiz.body.questions).toHaveLength(2);
    // P4-01: the learner-facing shape has nowhere to put a correctness marker.
    expect(JSON.stringify(quiz.body)).not.toContain("isCorrect");
    expectNoAnswerKey(quiz.body, "the learner's quiz");
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

  it("refuses a branding value that fails its grammar, and stores none of it", async () => {
    /*
     * The payload is a CSS injection — `primaryColor` closing its declaration
     * and opening a `background: url(…)`. Two properties matter and this used
     * to assert only the first:
     *
     * 1. **It is not stored.** That was true before and is still true.
     * 2. **The operator is told.** That was not. `parseBranding` dropped the
     *    field, the save answered 200, and the console said "Gespeichert." —
     *    so somebody who mistyped a hero image URL was told it worked and
     *    found the field empty later, with nothing to act on (P41-01).
     *
     * The whole request is now refused rather than partly applied: a save that
     * silently keeps some of what was submitted leaves the operator guessing
     * which half.
     */
    const refused = await asAdmin("PATCH", `/admin/projects/${projectSlug}`, {
      branding: { primaryColor: "red; background: url(evil)", cornerRadiusPx: 8 },
    });
    expect(refused.status).toBe(422);
    // The field's *name*, never the value — echoing an injection payload back
    // into a message a browser renders is how a refusal becomes the vector.
    expect(JSON.stringify(refused.body)).toContain("primaryColor");
    expect(JSON.stringify(refused.body)).not.toContain("url(evil)");

    const { body } = await asAdmin("GET", "/admin/projects");
    const branding = body.find((p: any) => p.slug === projectSlug).branding;
    expect(branding.primaryColor).toBeUndefined();
    // Nothing from the refused request landed, including the valid half.
    expect(branding.cornerRadiusPx).toBeUndefined();
  });

  it("accepts the same fields when every one of them is valid", async () => {
    // The other half of the refusal: this must not have made valid branding
    // unsaveable, which a too-eager validator easily would.
    const saved = await asAdmin("PATCH", `/admin/projects/${projectSlug}`, {
      branding: { primaryColor: "#E4003D", cornerRadiusPx: 8 },
    });
    expect(saved.status).toBe(200);

    const { body } = await asAdmin("GET", "/admin/projects");
    const branding = body.find((p: any) => p.slug === projectSlug).branding;
    expect(branding.primaryColor).toBe("#E4003D");
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

  /**
   * The console has to be able to create the kind of project the standalone
   * portal uses (P28-02).
   *
   * `identity_provider` was in the schema, in the CHECK constraint, and read on
   * every learner request — and settable by no API. Every project created here
   * got the column default, `keycloak`, so a customer who wanted the portal got
   * a project whose participants could not sign in at all. The only working
   * `local` projects in existence came from a seed.
   */
  it("creates a `local` project, and can switch an existing one", async () => {
    const slug = `lokal-${randomUUID().slice(0, 8)}`;

    await asAdmin("POST", "/admin/departments", { slug, name: "Portal-Abteilung" });

    const created = await asAdmin("POST", "/admin/projects", {
      departmentSlug: slug,
      slug,
      name: "Portal-Projekt",
      identityProvider: "local",
    });
    expect(created.status).toBe(201);
    expect(created.body.find((p: any) => p.slug === slug).identityProvider).toBe("local");

    // Read back through the list, not the create response, since that is the
    // screen an operator actually looks at.
    const listed = await asAdmin("GET", "/admin/projects");
    expect(listed.body.find((p: any) => p.slug === slug).identityProvider).toBe("local");

    // And it is reversible: a customer that later stands up a Keycloak realm
    // must not need a second project.
    const switched = await asAdmin("PATCH", `/admin/projects/${slug}`, {
      identityProvider: "keycloak",
    });
    expect(switched.status).toBe(200);
    expect(switched.body.find((p: any) => p.slug === slug).identityProvider).toBe(
      "keycloak",
    );
  });

  it("defaults to keycloak when the caller says nothing", async () => {
    // The pre-P28 behaviour, kept deliberately: every project that existed
    // before the field is a Keycloak project, and a caller that has not been
    // updated must keep getting one.
    const slug = `still-kc-${randomUUID().slice(0, 8)}`;
    await asAdmin("POST", "/admin/departments", { slug, name: "Abteilung" });

    const created = await asAdmin("POST", "/admin/projects", {
      departmentSlug: slug,
      slug,
      name: "Projekt",
    });

    expect(created.body.find((p: any) => p.slug === slug).identityProvider).toBe(
      "keycloak",
    );
  });

  /**
   * The customer's own sign-in page (P29-03).
   *
   * `projects.login_url` existed in the database, `resolve_project_signin`
   * returned it, and `GET /tenants/{slug}` branched on it to answer `external`
   * instead of `portal` — but the column was absent from the Drizzle schema, so
   * nothing this application ran could see it, let alone write it. Every
   * project answered "use the portal's own form", including MEDICE's, whose
   * physicians sign in through WordPress.
   */
  it("stores the customer's own login page, and the tenant lookup returns it", async () => {
    const slug = `wp-${randomUUID().slice(0, 8)}`;
    await asAdmin("POST", "/admin/departments", { slug, name: "WP-Abteilung" });
    await asAdmin("POST", "/admin/projects", {
      departmentSlug: slug,
      slug,
      name: "WordPress-Projekt",
    });

    const saved = await asAdmin("PATCH", `/admin/projects/${slug}`, {
      loginUrl: "https://www.medice.de/anmelden",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.find((p: any) => p.slug === slug).loginUrl).toBe(
      "https://www.medice.de/anmelden",
    );

    // And the portal's own lookup now answers `external` — the whole point.
    // Unauthenticated, as an anonymous visitor to `/{tenant}` is.
    const tenant = await fetch(`${baseUrl}/tenants/${slug}`);
    expect(tenant.status).toBe(200);
    const seen = (await tenant.json()) as { kind: string; url?: string };
    expect(seen.kind).toBe("external");
    expect(seen.url).toBe("https://www.medice.de/anmelden");
  });

  it("refuses a login page that is not HTTPS", async () => {
    const slug = `wp-plain-${randomUUID().slice(0, 8)}`;
    await asAdmin("POST", "/admin/departments", { slug, name: "Abteilung" });
    await asAdmin("POST", "/admin/projects", { departmentSlug: slug, slug, name: "P" });

    // A database CHECK enforces this too; refusing here makes it a 422 an
    // operator can read rather than a 500 from the driver.
    const refused = await asAdmin("PATCH", `/admin/projects/${slug}`, {
      loginUrl: "http://www.medice.de/anmelden",
    });
    expect(refused.status).toBe(422);
  });

  it("refuses an identity provider no class implements", async () => {
    const slug = `bogus-${randomUUID().slice(0, 8)}`;
    await asAdmin("POST", "/admin/departments", { slug, name: "Abteilung" });

    // 422, not a stored row: the CHECK constraint would catch it too, but as a
    // 500 — and a schema violation surfacing as "the server is broken" is how a
    // client-fixable mistake gets buried in the error rate.
    const created = await asAdmin("POST", "/admin/projects", {
      departmentSlug: slug,
      slug,
      name: "Projekt",
      identityProvider: "azure-ad",
    });
    expect(created.status).toBe(422);
  });
});

describe("an answered question leaves the exam and keeps its record", () => {
  let retiredId = "";
  let attemptId = "";

  /*
   * This suite adds its **own** question and retires that one.
   *
   * The first version retired one of the two questions the rest of the file
   * shares, and five later tests went red — they assert a two-question exam.
   * That is CLAUDE.md §9.8's lesson one layer along: state that outlives a test
   * shows up as a failure attributed to the wrong code, and the next person
   * would have gone looking at the learner endpoint rather than at this block.
   *
   * So the fixture is appended and removed within these tests, and the shared
   * exam is exactly as it was afterwards.
   */
  beforeAll(async () => {
    const { body: before } = await asAdmin(
      "GET",
      `/admin/contents/${quizContentId}/quiz`,
    );

    const passthrough = (question: any) => ({
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      options: question.options.map((option: any) => ({
        id: option.id,
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    });

    const { status, body } = await asAdmin(
      "PUT",
      `/admin/contents/${quizContentId}/quiz`,
      {
        questions: [
          ...before.questions.map(passthrough),
          {
            prompt: "Frage, die zurückgezogen wird",
            kind: "single",
            options: [
              { label: "Richtig", isCorrect: true },
              { label: "Falsch", isCorrect: false },
            ],
          },
        ],
      },
    );
    expect(status, JSON.stringify(body)).toBe(200);
    retiredId = body.questions.at(-1).id;

    /*
     * An attempt written straight into the database rather than driven through
     * the learner endpoints. The gate wants a watched video and a passing
     * score, and none of that is what this block is about — what matters is
     * that a `quiz_answers` row points at `retiredId`, because that row is
     * exactly what the old refusal was protecting.
     */
    /*
     * Reuse the enrolment the learner suite above already created, rather than
     * inventing one. `users` has had no `subject` column since P21-01 moved
     * identity to person/credential, so a hand-built insert here would be
     * writing against a schema that no longer exists — and this block runs last
     * precisely so the enrolment is there to find.
     */
    const enrolmentId = await insert(
      `SELECT e.id FROM enrolments e
         JOIN courses c ON c.id = e.course_id
        WHERE c.slug = $1
        ORDER BY e.created_at
        LIMIT 1`,
      [courseSlug],
    );

    attemptId = await insert(
      `INSERT INTO quiz_attempts
         (customer_id, enrolment_id, content_id, attempt_number,
          correct_count, total_count, score_percent, passed)
       SELECT customer_id, id, $2, 1, 3, 3, 100, true FROM enrolments WHERE id = $1
       RETURNING id`,
      [enrolmentId, quizContentId],
    );

    await insert(
      `INSERT INTO quiz_answers (customer_id, attempt_id, question_id, is_correct)
       SELECT customer_id, id, $2, true FROM quiz_attempts WHERE id = $1
       RETURNING id`,
      [attemptId, retiredId],
    );
  });

  it("reports the recorded answer, which is what used to refuse the edit", async () => {
    const { body } = await asAdmin("GET", `/admin/contents/${quizContentId}/quiz`);
    const answered = body.questions.find((q: any) => q.id === retiredId);
    expect(answered.answerCount).toBe(1);
  });

  it("accepts an edit that drops it — this is the whole defect", async () => {
    const { body: current } = await asAdmin(
      "GET",
      `/admin/contents/${quizContentId}/quiz`,
    );

    const { status, body } = await asAdmin(
      "PUT",
      `/admin/contents/${quizContentId}/quiz`,
      {
        questions: current.questions
          .filter((q: any) => q.id !== retiredId)
          .map((question: any) => ({
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

    // Before P114-01 this was a 409 naming the answer count, for ever.
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.questions.map((q: any) => q.id)).not.toContain(retiredId);
  });

  it("keeps the row, so the evidence behind a CME point still exists", async () => {
    const { rows } = await seedPool.query<{ retired: boolean }>(
      `SELECT retired_at IS NOT NULL AS retired FROM quiz_questions WHERE id = $1`,
      [retiredId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.retired).toBe(true);
  });

  it("keeps the recorded answer, which ON DELETE RESTRICT would have blocked", async () => {
    const { rows } = await seedPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_answers WHERE question_id = $1`,
      [retiredId],
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("does not move an already-scored attempt", async () => {
    // The property that makes any of this safe: a past result is denormalised
    // onto the attempt, so shortening the exam cannot retroactively change what
    // a physician scored — or whether they passed.
    const { rows } = await seedPool.query(
      `SELECT correct_count, total_count, score_percent, passed
         FROM quiz_attempts WHERE id = $1`,
      [attemptId],
    );
    expect(rows[0]).toMatchObject({
      correct_count: 3,
      total_count: 3,
      score_percent: 100,
      passed: true,
    });
  });

  it("says how many were retired, so the absence is not read as data loss", async () => {
    const { body } = await asAdmin("GET", `/admin/contents/${quizContentId}/quiz`);
    expect(body.retiredCount).toBe(1);
  });

  it("never serves the retired question to a learner again", async () => {
    const { rows } = await seedPool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM quiz_questions
        WHERE content_id = $1 AND retired_at IS NULL AND id = $2`,
      [quizContentId, retiredId],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("does not count it in a future attempt's total", async () => {
    /*
     * `findQuestionsForLearner` and `findAnswerKey` are separate queries, and
     * filtering one but not the other gives an exam whose visible questions and
     * whose scoring disagree. A retired question left in the key inflates
     * `totalCount`, so every learner is measured against an exam they were
     * never shown and the pass threshold quietly becomes unreachable.
     */
    const { rows } = await seedPool.query<{ n: number }>(
      `SELECT count(DISTINCT q.id)::int AS n
         FROM quiz_questions q
         JOIN quiz_options o ON o.question_id = q.id
        WHERE q.content_id = $1 AND q.retired_at IS NULL`,
      [quizContentId],
    );
    const { body } = await asAdmin("GET", `/admin/contents/${quizContentId}/quiz`);
    expect(rows[0]!.n).toBe(body.questions.length);
  });

  it("leaves the shared exam exactly as it found it", async () => {
    // Named as its own test rather than left implicit: if this block ever does
    // start leaking, the failure should say so here instead of surfacing three
    // describes later as "expected 2, got 1" (§9.8).
    const { body } = await asAdmin("GET", `/admin/contents/${quizContentId}/quiz`);
    expect(body.questions).toHaveLength(2);
  });
});

describe("media-check against a host that does not answer (P146-02)", () => {
  /*
   * `GET /admin/courses/:slug/media-check` probes every distinct media URL in a
   * course to ask whether a browser could seek it. The probes are
   * **sequential**, each with an 8-second deadline, and until this ticket the
   * whole loop ran inside the request's RLS transaction.
   *
   * So one operator opening the media report on a course whose CDN is wedged
   * held a pooled connection for `8 s × N distinct URLs` — the largest single
   * exposure of the shape P145 fixed for uploads, and one P145 did not touch
   * because I looked at the module in front of me instead of running the search
   * CLAUDE.md §11 rule 11 requires.
   *
   * §11 rule 10: this is fired concurrently, because a sequential version of
   * this test passes on the broken code — one probe holding one connection out
   * of ten is invisible.
   */
  let silent: Server;
  let silentUrl: string;

  beforeAll(async () => {
    silent = createServer(() => {
      // Accepts the connection, answers nothing. A host that returns 500 would
      // release the connection immediately and prove nothing (§9.13).
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const address = silent.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    silentUrl = `http://127.0.0.1:${String(address.port)}/wedged.mp4`;
  });

  afterAll(async () => {
    // The in-flight probes are deliberately never answered, and `close()` waits
    // for open connections — so without this the file hangs in teardown.
    silent.closeAllConnections();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  });

  it("keeps serving every other route while the probes are outstanding", async () => {
    const created = await asAdmin("POST", `/admin/chapters/${chapterIds[0]}/contents`, {
      kind: "video",
      title: "Video auf einem toten Host",
      sources: [{ url: silentUrl, mimeType: "video/mp4" }],
      durationSec: 600,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    // More than the pool's `max` of ten, so that on the old code every
    // connection is held and an eleventh caller has nothing to wait for.
    const probing = Array.from({ length: 12 }, () =>
      asAdmin("GET", `/admin/courses/${courseSlug}/media-check`).catch(
        (error: unknown) => ({ status: 0, body: { error: String(error) } }),
      ),
    );

    try {
      await new Promise((resolve) => setTimeout(resolve, 400));

      const started = Date.now();
      const answer = await asAdmin("GET", "/admin/courses");
      const elapsed = Date.now() - started;

      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // Well under the 5 s checkout timeout: the point is that it never queued.
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      await Promise.all(probing);
    }
  }, 40_000);
});

describe("a content-locked course refuses structural edits (P178-01)", () => {
  /*
   * The defect this block exists for, in the client's words:
   *
   *   > I have viewed the course, done with first video and done with the exam.
   *   > […] Now I have opened the course in verwaltung and I have added a new
   *   > video content for module 1 — Earlier the video percentage was 100%, now
   *   > it shows 75% completion only.
   *
   * Nothing was broken. `courseWatchCoverage` weights by duration across the
   * videos a course *currently* holds, so a course that grows re-denominates
   * everybody in it, including somebody who had finished.
   *
   * The lock is the refusal, and it has to be the **API's**, not a disabled
   * button: the console is a renderer (§4 invariant 1) and a direct POST must
   * get the same answer as the screen. Every structural route is exercised
   * here rather than a representative one, because `assertUnlocked` is called
   * per method and one missing call is a hole with no other detector — the
   * exact shape of §9.3.
   *
   * This block builds its **own** course. Locking the shared `courseSlug`
   * would break every describe below it, and a fixture reaching across tests
   * is P177's lesson (§9.6).
   */
  const lockSlug = `sperre-${RUN}`;
  let lockModuleId = "";
  let lockChapterId = "";
  let lockContentId = "";
  let lockQuizId = "";

  beforeAll(async () => {
    const course = await asAdmin("POST", "/admin/courses", {
      projectSlug,
      slug: lockSlug,
      title: "Zu sperrende Fortbildung",
    });
    expect(course.status, JSON.stringify(course.body)).toBe(201);

    const module = await asAdmin("POST", `/admin/courses/${lockSlug}/modules`, {
      title: "Modul 1",
      subtitle: null,
    });
    expect(module.status, JSON.stringify(module.body)).toBe(201);
    lockModuleId = module.body.modules[0].id;

    const chapter = await asAdmin("POST", `/admin/modules/${lockModuleId}/chapters`, {
      title: "Kapitel 1",
      body: null,
    });
    expect(chapter.status, JSON.stringify(chapter.body)).toBe(201);
    lockChapterId = chapter.body.modules[0].chapters[0].id;

    const video = await asAdmin("POST", `/admin/chapters/${lockChapterId}/contents`, {
      kind: "video",
      title: "Video",
      sources: [{ url: "https://cdn.example/v.mp4", mimeType: "video/mp4" }],
      durationSec: 600,
    });
    expect(video.status, JSON.stringify(video.body)).toBe(201);
    lockContentId = video.body.modules[0].chapters[0].contents[0].id;

    const quiz = await asAdmin("POST", `/admin/chapters/${lockChapterId}/contents`, {
      kind: "quiz",
      title: "Lernerfolgskontrolle",
    });
    expect(quiz.status, JSON.stringify(quiz.body)).toBe(201);
    lockQuizId = quiz.body.modules[0].chapters[0].contents[1].id;

    const questions = await asAdmin("PUT", `/admin/contents/${lockQuizId}/quiz`, {
      questions: [
        {
          kind: "single",
          prompt: "Welche Aussage trifft zu?",
          options: [
            { label: "Diese", isCorrect: true },
            { label: "Jene", isCorrect: false },
          ],
        },
      ],
    });
    expect(questions.status, JSON.stringify(questions.body)).toBe(200);

    const evaluation = await asAdmin("PUT", `/admin/courses/${lockSlug}/evaluation`, {
      questions: [{ kind: "scale", prompt: "Wie war es?", required: true, options: [] }],
    });
    expect(evaluation.status, JSON.stringify(evaluation.body)).toBe(200);
  }, 30_000);

  it("is created unlocked unless the operator asks for a lock", async () => {
    const { body } = await asAdmin("GET", "/admin/courses");
    const row = body.find((c: { slug: string }) => c.slug === lockSlug);
    expect(row.contentLocked).toBe(false);
  });

  it("can be created locked, because the client asked for it at creation", async () => {
    const slug = `gesperrt-ab-werk-${RUN}`;
    const created = await asAdmin("POST", "/admin/courses", {
      projectSlug,
      slug,
      title: "Ab Werk gesperrt",
      contentLocked: true,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const { body } = await asAdmin("GET", "/admin/courses");
    expect(body.find((c: { slug: string }) => c.slug === slug).contentLocked).toBe(true);

    // And it means it: the first module is refused, not merely reported.
    const module = await asAdmin("POST", `/admin/courses/${slug}/modules`, {
      title: "Modul",
      subtitle: null,
    });
    expect(module.status).toBe(409);
  });

  it("locks on request, and says so on the summary", async () => {
    const patched = await asAdmin("PATCH", `/admin/courses/${lockSlug}`, {
      contentLocked: true,
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    const { body } = await asAdmin("GET", "/admin/courses");
    const row = body.find((c: { slug: string }) => c.slug === lockSlug);
    expect(row.contentLocked).toBe(true);
  });

  /*
   * Every write that changes the shape of the tree, one per route. A table
   * rather than seven `it`s so that adding a structural route and forgetting
   * `slugForEdit` fails here with the route's own name in the message.
   */
  const REFUSED: readonly [string, string, () => string, unknown][] = [
    [
      "POST",
      "a second module",
      () => `/admin/courses/${lockSlug}/modules`,
      {
        title: "Modul 2",
        subtitle: null,
      },
    ],
    [
      "PATCH",
      "the module's title",
      () => `/admin/modules/${lockModuleId}`,
      {
        title: "Anders",
        subtitle: null,
      },
    ],
    ["DELETE", "the module", () => `/admin/modules/${lockModuleId}`, undefined],
    [
      "POST",
      "a chapter",
      () => `/admin/modules/${lockModuleId}/chapters`,
      {
        title: "Kapitel 2",
        body: null,
      },
    ],
    [
      "PATCH",
      "the chapter",
      () => `/admin/chapters/${lockChapterId}`,
      {
        title: "Anders",
        body: null,
      },
    ],
    ["DELETE", "the chapter", () => `/admin/chapters/${lockChapterId}`, undefined],
    [
      "POST",
      "the video the client added",
      () => `/admin/chapters/${lockChapterId}/contents`,
      {
        kind: "video",
        title: "Noch ein Video",
        sources: [{ url: "https://cdn.example/w.mp4", mimeType: "video/mp4" }],
        durationSec: 300,
      },
    ],
    [
      "PATCH",
      "the video",
      () => `/admin/contents/${lockContentId}`,
      {
        kind: "video",
        title: "Anders",
        sources: [{ url: "https://cdn.example/v.mp4", mimeType: "video/mp4" }],
        durationSec: 600,
      },
    ],
    ["DELETE", "the video", () => `/admin/contents/${lockContentId}`, undefined],
    [
      "PUT",
      "the exam's questions",
      () => `/admin/contents/${lockQuizId}/quiz`,
      {
        questions: [
          {
            kind: "single",
            prompt: "Eine andere Frage?",
            options: [
              { label: "Ja", isCorrect: true },
              { label: "Nein", isCorrect: false },
            ],
          },
        ],
      },
    ],
    [
      "PUT",
      "the Evaluationsbogen",
      () => `/admin/courses/${lockSlug}/evaluation`,
      {
        questions: [{ kind: "scale", prompt: "Und jetzt?", required: true, options: [] }],
      },
    ],
  ];

  for (const [method, what, path, body] of REFUSED) {
    it(`refuses ${method} ${what}`, async () => {
      const { status, body: answer } = await asAdmin(method, path(), body);

      expect(status, `${method} ${path()} → ${JSON.stringify(answer)}`).toBe(409);
      // §9.4: the sentence has to say what happened and what to do about it.
      expect(answer.detail).toContain("gesperrt");
      expect(answer.detail).toContain("Kopie");
      // §9.5: the *sentence* names no identifier. `instance` is the request
      // path, which the caller wrote, so an id there is not a disclosure.
      expect(answer.detail).not.toContain(lockModuleId);
      expect(answer.detail).not.toContain(lockSlug);
    });
  }

  it("refuses a reorder, which is a structural edit wearing a different verb", async () => {
    const { status } = await asAdmin(
      "PUT",
      `/admin/courses/${lockSlug}/structure/order`,
      {
        modules: [{ id: lockModuleId, chapters: [{ id: lockChapterId, contents: [] }] }],
      },
    );
    expect(status).toBe(409);
  });

  it("still allows the course's own fields, because a VNR arrives after the lock", async () => {
    /*
     * The half of this that would be easy to get wrong. An Anerkennungsbescheid
     * turns up weeks after a course is built and carries the VNR that every
     * certificate has to print; a lock that refused it would make the platform
     * unable to record the one number the Ärztekammer identifies the event by.
     * The lock is about **material**, never about the event's identity.
     */
    const { status, body } = await asAdmin("PATCH", `/admin/courses/${lockSlug}`, {
      title: "Zu sperrende Fortbildung (korrigiert)",
      vnr: "2760909004711220012",
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.vnr).toBe("2760909004711220012");
  });

  it("reads the tree out unchanged — a refusal that half-applied would be worse", async () => {
    const { body } = await asAdmin("GET", `/admin/courses/${lockSlug}/structure`);
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].chapters).toHaveLength(1);
    expect(body.modules[0].chapters[0].contents).toHaveLength(2);
  });

  it("reopens on request, and the refused edit then goes through", async () => {
    const unlocked = await asAdmin("PATCH", `/admin/courses/${lockSlug}`, {
      contentLocked: false,
    });
    expect(unlocked.status, JSON.stringify(unlocked.body)).toBe(200);

    const module = await asAdmin("POST", `/admin/courses/${lockSlug}/modules`, {
      title: "Modul 2",
      subtitle: null,
    });
    expect(module.status, JSON.stringify(module.body)).toBe(201);
    expect(module.body.modules).toHaveLength(2);

    // Put it back, so the clone block below starts from a locked source.
    const relocked = await asAdmin("PATCH", `/admin/courses/${lockSlug}`, {
      contentLocked: true,
    });
    expect(relocked.status).toBe(200);
  });

  describe("cloning is the way past a lock that does not disturb the original (P178-02)", () => {
    const cloneSlug = `sperre-kopie-${RUN}`;

    it("copies a locked course into a new, unlocked draft", async () => {
      const { status, body } = await asAdmin("POST", `/admin/courses/${lockSlug}/clone`, {
        slug: cloneSlug,
        title: "Kopie der Fortbildung",
      });

      expect(status, JSON.stringify(body)).toBe(201);
      expect(body.modules).toHaveLength(2);
      expect(body.modules[0].chapters[0].contents).toHaveLength(2);

      const list = await asAdmin("GET", "/admin/courses");
      const copy = list.body.find((c: { slug: string }) => c.slug === cloneSlug);
      expect(copy.contentLocked).toBe(false);
      expect(copy.status).toBe("draft");
      expect(copy.title).toBe("Kopie der Fortbildung");
    });

    it("carries no VNR, because two courses may not report against one", async () => {
      /*
       * The compliance half, and the reason this is not a generic "duplicate
       * row" feature. A VNR identifies one accredited event at the Ärztekammer.
       * A Punktemeldung filed from a clone that inherited it would credit the
       * original's registration — a wrong statutory report against a real
       * physician's EFN, which is §7 territory rather than a bug.
       */
      const { rows } = await seedPool.query<{
        vnr: string | null;
        vnr_password_enc: Buffer | null;
        valid_from: Date | null;
        valid_to: Date | null;
        cme_points: number | null;
      }>(
        `SELECT vnr, vnr_password_enc, valid_from, valid_to, cme_points
           FROM courses WHERE slug = $1 AND customer_id = $2`,
        [cloneSlug, customerId],
      );

      expect(rows[0]!.vnr).toBeNull();
      expect(rows[0]!.vnr_password_enc).toBeNull();
      expect(rows[0]!.valid_from).toBeNull();
      expect(rows[0]!.valid_to).toBeNull();
    });

    it("copies the exam's questions and their options, not just the shell", async () => {
      const structure = await asAdmin("GET", `/admin/courses/${cloneSlug}/structure`);
      const quiz = structure.body.modules[0].chapters[0].contents.find(
        (c: { kind: string }) => c.kind === "quiz",
      );

      const { body } = await asAdmin("GET", `/admin/contents/${quiz.id}/quiz`);
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0].prompt).toBe("Welche Aussage trifft zu?");
      expect(body.questions[0].options).toHaveLength(2);
      /*
       * The answer key survives. An exam copied without `isCorrect` would be
       * unpassable — every attempt scores zero — and it would look fine on
       * every screen an author opens, because the console draws the prompts.
       * This is the admin quiz route, the one route allowed to carry a
       * correctness marker at all.
       */
      expect(
        body.questions[0].options.filter((o: { isCorrect: boolean }) => o.isCorrect),
      ).toHaveLength(1);
    });

    it("copies the Evaluationsbogen", async () => {
      const { body } = await asAdmin("GET", `/admin/courses/${cloneSlug}/evaluation`);
      expect(body.questions).toHaveLength(1);
      expect(body.questions[0].prompt).toBe("Wie war es?");
    });

    it("leaves the source untouched, locked and with its own rows", async () => {
      const source = await asAdmin("GET", `/admin/courses/${lockSlug}/structure`);
      expect(source.body.modules).toHaveLength(2);

      const list = await asAdmin("GET", "/admin/courses");
      expect(
        list.body.find((c: { slug: string }) => c.slug === lockSlug).contentLocked,
      ).toBe(true);

      // No row of the copy belongs to the source's tree, and vice versa.
      const { rows } = await seedPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM modules m
           JOIN courses c ON c.id = m.course_id
          WHERE c.slug = $1 AND c.customer_id = $2`,
        [cloneSlug, customerId],
      );
      expect(rows[0]!.n).toBe(2);
    });

    it("is editable straight away — that is what it is for", async () => {
      const { status, body } = await asAdmin(
        "POST",
        `/admin/courses/${cloneSlug}/modules`,
        {
          title: "Ein Modul, das im Original nicht geht",
          subtitle: null,
        },
      );
      expect(status, JSON.stringify(body)).toBe(201);
      expect(body.modules).toHaveLength(3);
    });

    it("refuses a slug that is already taken, rather than shadowing a course", async () => {
      const { status, body } = await asAdmin("POST", `/admin/courses/${lockSlug}/clone`, {
        slug: cloneSlug,
        title: "Noch eine Kopie",
      });
      expect(status).toBe(409);
      expect(body.detail).toContain("existiert bereits");
    });

    it("copies every column of every cloned table, or deliberately resets it", async () => {
      /*
       * The class fix (§9.11) for the defect that made this block red on its
       * first run: `cloneCourse`'s INSERT named `course_experts (name, title,
       * bio, photo_url)`, and the table's columns are `role_label, name,
       * institution, biography, photo_url`. It failed loudly because the names
       * did not exist — the version that would not have is a column **added
       * next year** and silently left out, producing a copy quietly poorer
       * than its source.
       *
       * So the lists are checked against `information_schema` rather than
       * against my memory of the schema. Every column is in exactly one of two
       * sets: copied, or reset with a reason. A new column is in neither, and
       * this goes red until somebody decides which.
       */
      const COPIED: Record<string, readonly string[]> = {
        courses: [
          "customer_id",
          "project_id",
          "description",
          "delivery_type",
          "thema",
          "altersgruppe",
          "accreditation_body",
          "cme_points",
          "cme_category",
          "event_location",
          "organizer",
          "required_watch_percent",
          "pass_threshold_percent",
          "max_quiz_attempts",
          "reveal_correct_answers",
          "hero_image_url",
          "learning_objectives",
          "target_audience",
          "prerequisites",
          "scientific_lead_name",
          "scientific_lead_title",
          "stamp_image",
          "stamp_image_mime",
          "signature_image",
          "signature_image_mime",
          "certificate_issue_place",
          "eiv_punkte_basis",
          "eiv_punkte_lernerfolg",
        ],
        modules: ["customer_id", "course_id", "ordinal", "title", "subtitle"],
        chapters: ["customer_id", "module_id", "ordinal", "title", "body"],
        contents: [
          "customer_id",
          "chapter_id",
          "ordinal",
          "kind",
          "title",
          "body",
          "description",
          "duration_sec",
          "media_sources",
          "poster_url",
          "thumbnail_url",
          "captions_url",
          "file_url",
          "mime_type",
          "file_size",
        ],
        quiz_questions: ["customer_id", "content_id", "ordinal", "kind", "prompt"],
        quiz_options: ["customer_id", "question_id", "ordinal", "label", "is_correct"],
        course_experts: [
          "customer_id",
          "course_id",
          "ordinal",
          "role_label",
          "name",
          "institution",
          "biography",
          "photo_url",
        ],
        evaluations: [
          "customer_id",
          "course_id",
          "ordinal",
          "kind",
          "prompt",
          "required",
          "options",
        ],
      };

      /** Not copied, each with the reason. */
      const RESET: Record<string, readonly string[]> = {
        courses: [
          "id",
          "created_at",
          "updated_at",
          // The caller supplies both — a copy sharing either is not a copy.
          "slug",
          "title",
          // Accreditation identity: one registered event, one number.
          "vnr",
          "vnr_password_enc",
          "fortbildungsnummer",
          // The Bescheid's window, which this course does not have yet.
          "valid_from",
          "valid_to",
          // A copy must not appear on a catalogue because somebody clicked once.
          "status",
          // The point of the feature.
          "content_locked",
        ],
        modules: ["id", "created_at", "updated_at"],
        chapters: ["id", "created_at", "updated_at"],
        contents: ["id", "created_at", "updated_at"],
        // A clone has no attempts, so a replaced question has nothing to
        // preserve and is not resurrected.
        quiz_questions: ["id", "created_at", "retired_at"],
        quiz_options: ["id"],
        course_experts: ["id", "created_at"],
        evaluations: ["id"],
      };

      for (const [table, copied] of Object.entries(COPIED)) {
        const { rows } = await seedPool.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1`,
          [table],
        );
        expect(
          rows.length,
          `${table} has no columns — wrong table name?`,
        ).toBeGreaterThan(0);

        const accounted = new Set([...copied, ...(RESET[table] ?? [])]);
        const unaccounted = rows
          .map((row) => row.column_name)
          .filter((column) => !accounted.has(column));

        expect(
          unaccounted,
          `${table}.${unaccounted.join(", ")} is neither copied by cloneCourse ` +
            `nor listed as deliberately reset. Decide which, in the repository ` +
            `and here (P178-02).`,
        ).toEqual([]);
      }
    });

    it("is closed to a learner, like every other authoring route", async () => {
      const { status } = await asLearner("POST", `/admin/courses/${lockSlug}/clone`, {
        slug: `kopie-lernender-${RUN}`,
        title: "Nicht erlaubt",
      });
      expect(status).toBe(403);
    });

    it("does not clone a course from another customer", async () => {
      const { status } = await asAdmin("POST", "/admin/courses/gibt-es-nicht/clone", {
        slug: `kopie-fremd-${RUN}`,
        title: "Nicht erlaubt",
      });
      expect(status).toBe(404);
    });
  });
});
