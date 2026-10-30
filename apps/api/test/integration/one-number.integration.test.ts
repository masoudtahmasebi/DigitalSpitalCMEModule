/**
 * One number on every screen (P248-01).
 *
 * ## Why this file exists
 *
 * CLAUDE.md §4 invariant 6: learner progress and admin reporting read the same
 * rollup. `completion-flow` already asserts that for the Teilnehmende list, and
 * it was green while three things disagreed — because its course has
 * evaluation questions, a quiz scored 100 against a threshold of 70, and it
 * never opened the Lernende screen.
 *
 * So this course is shaped exactly where they diverged:
 *
 * - **no evaluation questions** — P206-01 skips the step; the admin list
 *   called the rollup without saying so and the domain's `?? true` asked for
 *   an evaluation that can never exist (ARCH-1);
 * - **one video and one quiz** — the Lernende screen averaged every progress
 *   row, quiz rows counted at their default 0, and showed 50 where every other
 *   screen showed 100 (ARCH-2);
 * - **a score exactly at the threshold** — so every caller of
 *   `meetsPassThreshold` is exercised on the one value where `>=` and `>`
 *   differ, and reverting any of them to its own comparison can go red
 *   (ARCH-3, §9.7).
 *
 * Every row hangs off this file's own tenant (§9.6): nothing is selected from a
 * shared table without the course or enrolment that pins it.
 */

import { randomUUID } from "node:crypto";
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

const KID = "one-number-key";
const AUDIENCE = "ds-education-api";
const RUN = randomUUID().slice(0, 8);
const SUB = `one-number-learner-${RUN}`;
const ADMIN_SUB = `one-number-admin-${RUN}`;
const VIDEO_SEC = 120;
/** Two questions, one answered right: 50 % — exactly the threshold. */
const PASS_THRESHOLD = 50;

let jwksServer: Server;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

let projectSlug: string;
let courseSlug: string;
let videoId: string;
let quizId: string;
let enrolmentId: string;
const questionIds: string[] = [];
const rightOption = new Map<string, string>();
const wrongOption = new Map<string, string>();

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/one-number`;

  projectSlug = `on-project-${RUN}`;
  courseSlug = `on-course-${RUN}`;

  const customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`on-customer-${RUN}`, "One Number GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,'default','Default') RETURNING id",
    [customerId],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "ON project", issuer, AUDIENCE],
  );
  // No CME points: no EFN is asked for, so "complete" turns on the watch, the
  // quiz and the evaluation alone — the three this ticket is about.
  const courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,100,$5,'published') RETURNING id`,
    [customerId, projectId, courseSlug, "One number course", PASS_THRESHOLD],
  );
  const moduleId = await insert(
    "INSERT INTO modules (customer_id, course_id, ordinal, title) VALUES ($1,$2,0,'Modul 1') RETURNING id",
    [customerId, courseId],
  );
  const chapterId = await insert(
    "INSERT INTO chapters (customer_id, module_id, ordinal, title) VALUES ($1,$2,0,'Kapitel 1') RETURNING id",
    [customerId, moduleId],
  );
  videoId = await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, media_sources)
     VALUES ($1,$2,0,'video','Lektion',$3,$4::jsonb) RETURNING id`,
    [
      customerId,
      chapterId,
      VIDEO_SEC,
      JSON.stringify([
        {
          url: "https://cdn.example.org/lektion.mp4",
          mimeType: "video/mp4",
          label: null,
        },
      ]),
    ],
  );
  quizId = await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title)
     VALUES ($1,$2,1,'quiz','Lernerfolgskontrolle') RETURNING id`,
    [customerId, chapterId],
  );
  for (const ordinal of [0, 1]) {
    const questionId = await insert(
      `INSERT INTO quiz_questions (customer_id, content_id, ordinal, kind, prompt)
       VALUES ($1,$2,$3,'single',$4) RETURNING id`,
      [customerId, quizId, ordinal, `Frage ${ordinal + 1}`],
    );
    questionIds.push(questionId);
    rightOption.set(
      questionId,
      await insert(
        `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
         VALUES ($1,$2,0,'Richtig',true) RETURNING id`,
        [customerId, questionId],
      ),
    );
    wrongOption.set(
      questionId,
      await insert(
        `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
         VALUES ($1,$2,1,'Falsch',false) RETURNING id`,
        [customerId, questionId],
      ),
    );
  }
  // Deliberately no `INSERT INTO evaluations`: that is the course under test.

  const { id: userId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: SUB,
    email: `${SUB}@example.org`,
    firstName: "Anna",
    lastName: "Müller",
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [userId, customerId],
  );
  const { id: adminId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: ADMIN_SUB,
    email: `${ADMIN_SUB}@example.org`,
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [adminId, customerId],
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

async function request(
  sub: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const jwt = await new SignJWT({ email: `${sub}@example.org` })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(privateKey);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-ds-project": projectSlug,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function call(
  sub: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await request(sub, method, path, body);
  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

const halfRight = () => ({
  answers: [
    { questionId: questionIds[0], selectedOptionIds: [rightOption.get(questionIds[0]!)] },
    { questionId: questionIds[1], selectedOptionIds: [wrongOption.get(questionIds[1]!)] },
  ],
});

async function participantRow(): Promise<any> {
  const admin = await call(ADMIN_SUB, "GET", `/admin/courses/${courseSlug}/participants`);
  expect(admin.status).toBe(200);
  return admin.body.rows.find(
    (row: { enrolmentId: string }) => row.enrolmentId === enrolmentId,
  );
}

describe("a learner finishes a course with no evaluation questions, at exactly the threshold", () => {
  it("watches the whole video", async () => {
    const enrolled = await call(SUB, "PUT", `/courses/${courseSlug}/enrolment`);
    expect(enrolled.status).toBe(200);
    enrolmentId = enrolled.body.enrolmentId;
    // P206-01 at the learner's end: the course asks nothing, so nothing waits.
    expect(enrolled.body.outstanding).not.toContain("evaluation");

    await backdateLearnerClock(seedPool, 3600);
    const watched = await call(
      SUB,
      "POST",
      `/courses/${courseSlug}/contents/${videoId}/progress`,
      { segments: [{ startSec: 0, endSec: VIDEO_SEC }] },
    );
    expect(watched.body.watchedPercent).toBe(100);
  });

  it("passes with a score equal to the threshold (scoreQuiz)", async () => {
    const { status, body } = await call(
      SUB,
      "POST",
      `/courses/${courseSlug}/contents/${quizId}/quiz`,
      halfRight(),
    );
    expect(status).toBe(200);
    expect(body.scorePercent).toBe(PASS_THRESHOLD);
    expect(body.passed).toBe(true);
  });

  it("records the quiz as completed (assessment.service, the progress upsert)", async () => {
    const { rows } = await seedPool.query<{ status: string }>(
      `SELECT cp.status::text AS status
         FROM content_progress cp
        WHERE cp.enrolment_id = $1 AND cp.content_id = $2`,
      [enrolmentId, quizId],
    );
    expect(rows).toEqual([{ status: "completed" }]);
  });

  it("refuses a second attempt on the passed exam (assessment.service, the re-attempt guard)", async () => {
    const { status } = await call(
      SUB,
      "POST",
      `/courses/${courseSlug}/contents/${quizId}/quiz`,
      halfRight(),
    );
    expect(status).toBe(409);
  });

  it("is told by its own screen that the quiz is passed and the course complete (hasPassedQuiz)", async () => {
    const { body } = await call(SUB, "GET", `/courses/${courseSlug}/enrolment`);
    expect(body.quizPassed).toBe(true);
    expect(body.achievedWatchPercent).toBe(100);
    expect(body.outstanding).toEqual([]);
    expect(body.complete).toBe(true);
  });
});

describe("the console agrees with the learner (§4 invariant 6)", () => {
  it('agrees about "complete" on the Teilnehmende list and in the CSV (ARCH-1)', async () => {
    const learner = await call(SUB, "GET", `/courses/${courseSlug}/enrolment`);
    const row = await participantRow();

    expect(row).toBeDefined();
    expect(row.courseComplete).toBe(learner.body.courseComplete);
    expect(row.complete).toBe(learner.body.complete);
    expect(row.complete).toBe(true);

    const response = await request(
      ADMIN_SUB,
      "GET",
      `/admin/courses/${courseSlug}/participants.csv`,
    );
    expect(response.status).toBe(200);
    const lines = (await response.text())
      .replace(/^\uFEFF/, "")
      .split("\r\n")
      .filter((line) => line !== "" && !line.startsWith("sep="));
    const cells = (line: string) =>
      line
        .slice(1, -1)
        .split('";"')
        .map((cell) => cell.replaceAll('""', '"'));
    const header = cells(lines[0]!);
    expect(lines).toHaveLength(2);
    const data = cells(lines[1]!);
    const column = (name: string) => data[header.indexOf(name)];

    expect(column("Fortbildung abgeschlossen")).toBe("ja");
    expect(column("Zertifiziert")).toBe(learner.body.complete ? "ja" : "nein");
  });

  it("shows 100 on both the Lernende and the Teilnehmende screens (ARCH-2)", async () => {
    const learner = await call(SUB, "GET", `/courses/${courseSlug}/enrolment`);
    const row = await participantRow();
    const learners = await call(ADMIN_SUB, "GET", `/admin/learners?course=${courseSlug}`);
    expect(learners.status).toBe(200);
    const record = learners.body.find(
      (entry: { enrolmentId: string }) => entry.enrolmentId === enrolmentId,
    );

    expect(record).toBeDefined();
    expect(row.watchedPercent).toBe(100);
    expect(record.watchedPercent).toBe(100);
    expect(record.watchedPercent).toBe(learner.body.achievedWatchPercent);
  });
});
