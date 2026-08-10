/**
 * The full journey to a CME point (P4, P6, P1-06, P7), against real Postgres.
 *
 * This is the suite that matters most: it walks a learner from an empty
 * enrolment to a queued Punktemeldung, and asserts at each step that the
 * server refuses to shortcut. Everything below goes through HTTP against the
 * real `AppModule` — no service is called directly, no repository is faked.
 *
 * The properties it exists to prove:
 *
 * - The answer key never appears in any learner-facing response.
 * - A quiz cannot be passed by asserting a score; only by answering correctly.
 * - Completion is refused while any condition is outstanding, however the
 *   client asks.
 * - Completion is idempotent, because the statutory reporting clock starts on
 *   the first one.
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
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
// The submission worker has its own suite; leaving it sweeping here would
// mutate eiv_submissions rows underneath these assertions.
process.env["EIV_WORKER_ENABLED"] = "no";

const KID = "completion-flow-key";
const AUDIENCE = "ds-education-api";
/**
 * Unique per run. The suite seeds its users under `(realm, subject)` in
 * `user_identities`, and the realm is the JWKS server's ephemeral URL — which the
 * OS will happily hand back to a later run. A fixed subject then collides with
 * the previous run's row, and the collision only appears when a port is
 * reused, which is exactly the kind of failure nobody can reproduce.
 */
const RUN = randomUUID().slice(0, 8);
const SUB = `completion-learner-${RUN}`;
const ADMIN_SUB = `completion-admin-${RUN}`;
const VNR = "9999999999999999999";
const EFN = "123456789012345";
/** What the learner confirms at completion — deliberately not the token's name. */
const ATTESTED_NAME = "Dr. med. Anna Müller";
const VIDEO_SEC = 300;

/** 1×1 PNG, stored as the course's stamp and signature. */
const PLACEHOLDER_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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
const correctOptionByQuestion = new Map<string, string>();
const wrongOptionByQuestion = new Map<string, string>();
let evaluationId: string;

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/completion-flow`;

  const suffix = randomUUID().slice(0, 8);
  projectSlug = `cf-project-${suffix}`;
  courseSlug = `cf-course-${suffix}`;

  const customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`cf-customer-${suffix}`, "Completion Flow GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "CF project", issuer, AUDIENCE],
  );
  const courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, vnr, cme_points, cme_category,
                          organizer, event_location, accreditation_body,
                          scientific_lead_name, scientific_lead_title,
                          certificate_issue_place,
                          stamp_image, stamp_image_mime,
                          signature_image, signature_image_mime)
     VALUES ($1,$2,$3,$4,100,70,$5,4,'D',$6,'online',$7,$8,'Prof. Dr. med.','Iserlohn',
             $9,'image/png',$9,'image/png') RETURNING id`,
    [
      customerId,
      projectId,
      courseSlug,
      "Completion flow course",
      VNR,
      "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
      "Ärztekammer Westfalen-Lippe",
      "Muster-Leitung",
      PLACEHOLDER_IMAGE,
    ],
  );

  // One module, one chapter, one video then one quiz — the smallest course
  // that still exercises every gate.
  const moduleId = await insert(
    "INSERT INTO modules (customer_id, course_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, courseId, "Modul 1"],
  );
  const chapterId = await insert(
    "INSERT INTO chapters (customer_id, module_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, moduleId, "Kapitel 1"],
  );
  videoId = await insert(
    // A source is required by `contents_video_needs_a_source`: a video with
    // none is unplayable, and the watch gate would credit the learner nothing
    // for content they could never have watched.
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, media_sources)
     VALUES ($1,$2,0,'video',$3,$4,$5::jsonb) RETURNING id`,
    [
      customerId,
      chapterId,
      "Lektion",
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
     VALUES ($1,$2,1,'quiz',$3) RETURNING id`,
    [customerId, chapterId, "Lernerfolgskontrolle"],
  );

  // Two single-choice questions: at 70 %, one wrong answer is a fail.
  for (const ordinal of [0, 1]) {
    const questionId = await insert(
      `INSERT INTO quiz_questions (customer_id, content_id, ordinal, kind, prompt)
       VALUES ($1,$2,$3,'single',$4) RETURNING id`,
      [customerId, quizId, ordinal, `Frage ${ordinal + 1}`],
    );
    questionIds.push(questionId);

    const right = await insert(
      `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
       VALUES ($1,$2,0,$3,true) RETURNING id`,
      [customerId, questionId, "Richtig"],
    );
    const wrong = await insert(
      `INSERT INTO quiz_options (customer_id, question_id, ordinal, label, is_correct)
       VALUES ($1,$2,1,$3,false) RETURNING id`,
      [customerId, questionId, "Falsch"],
    );
    correctOptionByQuestion.set(questionId, right);
    wrongOptionByQuestion.set(questionId, wrong);
  }

  evaluationId = await insert(
    `INSERT INTO evaluations (customer_id, course_id, ordinal, prompt, kind, required, options)
     VALUES ($1,$2,0,$3,'scale',true,$4::jsonb) RETURNING id`,
    [
      customerId,
      courseId,
      "Wie bewerten Sie die Fortbildung?",
      JSON.stringify(["1", "2", "3", "4", "5"]),
    ],
  );

  const { id: userId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: SUB,
    email: "learner@example.org",
    firstName: "Anna",
    lastName: "Müller",
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [userId, customerId],
  );

  // A customer admin in the same tenant, for the console's own assertions.
  const { id: adminId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: ADMIN_SUB,
    email: "admin@example.org",
    firstName: "Admin",
    lastName: "Person",
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [adminId, customerId],
  );

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    // Configured by `configureApp` below, exactly as `main.ts` does it. A
    // suite that boots the app differently from production is testing a
    // different application — which is how the font route's body limit got
    // past this suite once already.
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

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return callAs(SUB, method, path, body);
}

/** The same request, as somebody else — used for the admin console's own calls. */
async function callAs(
  sub: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  // Profile claims on purpose: `provisionOrUpdate` writes them into `users` on
  // every request, which is what the erasure trigger has to hold against. A
  // token with no name would make that assertion pass whether the trigger
  // exists or not.
  const jwt = await new SignJWT({
    email: `${sub}@example.org`,
    given_name: "Anna",
    family_name: "Müller",
  })
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

describe("the road to a CME point", () => {
  it("enrols and reports everything outstanding", async () => {
    const { status, body } = await call("PUT", `/courses/${courseSlug}/enrolment`);

    expect(status).toBe(200);
    expect(body.outstanding).toEqual(["watch", "quiz", "evaluation", "efn"]);
    enrolmentId = body.enrolmentId;
  });

  it("refuses completion at the very start", async () => {
    const { status, body } = await call("POST", `/courses/${courseSlug}/completion`);

    expect(status).toBe(409);
    // The problem document says what is missing without leaking internals.
    expect(body.detail).toContain("Videowiedergabe");
  });

  it("serves the quiz with no correctness marker anywhere", async () => {
    const { status, body } = await call(
      "GET",
      `/courses/${courseSlug}/contents/${quizId}/quiz`,
    );

    expect(status).toBe(200);
    expect(body.questions).toHaveLength(2);

    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("is_correct");
    // The strongest check: no correct option id appears in the payload at all.
    for (const optionId of correctOptionByQuestion.values()) {
      expect(
        body.questions.flatMap((q: any) => q.options.map((o: any) => o.id)),
      ).toContain(optionId);
    }
    // ...they appear as options, of course — but nothing marks which is right.
    expect(serialised.match(/true/g)).toBeNull();
  });

  it("fails a half-right attempt against the 70 % threshold", async () => {
    const { status, body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${quizId}/quiz`,
      {
        answers: [
          {
            questionId: questionIds[0],
            selectedOptionIds: [correctOptionByQuestion.get(questionIds[0]!)],
          },
          {
            questionId: questionIds[1],
            selectedOptionIds: [wrongOptionByQuestion.get(questionIds[1]!)],
          },
        ],
      },
    );

    expect(status).toBe(200);
    expect(body.scorePercent).toBe(50);
    expect(body.passed).toBe(false);
    // No per-question feedback: with retries allowed that is the answer key.
    expect(body.perQuestion).toBeUndefined();
  });

  it("cannot be passed by asserting a score in the request", async () => {
    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${quizId}/quiz`,
      {
        scorePercent: 100,
        passed: true,
        answers: [
          {
            questionId: questionIds[0],
            selectedOptionIds: [wrongOptionByQuestion.get(questionIds[0]!)],
          },
          {
            questionId: questionIds[1],
            selectedOptionIds: [wrongOptionByQuestion.get(questionIds[1]!)],
          },
        ],
      },
    );

    expect(body.scorePercent).toBe(0);
    expect(body.passed).toBe(false);
  });

  it("passes when the answers are actually right", async () => {
    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${quizId}/quiz`,
      {
        answers: questionIds.map((id) => ({
          questionId: id,
          selectedOptionIds: [correctOptionByQuestion.get(id)],
        })),
      },
    );

    expect(body.scorePercent).toBe(100);
    expect(body.passed).toBe(true);
    expect(body.attemptNumber).toBe(3);
  });

  it("keeps the best score after a later failed attempt", async () => {
    await call("POST", `/courses/${courseSlug}/contents/${quizId}/quiz`, {
      answers: questionIds.map((id) => ({
        questionId: id,
        selectedOptionIds: [wrongOptionByQuestion.get(id)],
      })),
    });

    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);
    expect(body.quizPassed).toBe(true);
  });

  it("still refuses completion with the video unwatched", async () => {
    const { status, body } = await call("POST", `/courses/${courseSlug}/completion`);

    expect(status).toBe(409);
    expect(body.detail).toContain("Videowiedergabe");
  });

  it("accepts the watched video", async () => {
    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${videoId}/progress`,
      { segments: [{ startSec: 0, endSec: VIDEO_SEC }] },
    );

    expect(body.watchedPercent).toBe(100);
  });

  it("refuses an EFN that is not 15 digits, without echoing it back", async () => {
    const { status, body } = await call("PUT", "/profile/efn", { efn: "12345" });

    expect(status).toBe(422);
    expect(JSON.stringify(body)).not.toContain("12345");
  });

  it("refuses completion with only the evaluation and EFN outstanding", async () => {
    const { status, body } = await call("POST", `/courses/${courseSlug}/completion`);

    expect(status).toBe(409);
    expect(body.detail).toContain("Evaluation");
    expect(body.detail).toContain("EFN");
  });

  it("records the evaluation", async () => {
    const { status, body } = await call("POST", `/courses/${courseSlug}/evaluation`, {
      answers: [{ evaluationId, answer: 5 }],
    });

    expect(status).toBe(200);
    expect(body.evaluationSubmitted).toBe(true);
  });

  it("refuses a second evaluation rather than overwriting the first", async () => {
    const { status } = await call("POST", `/courses/${courseSlug}/evaluation`, {
      answers: [{ evaluationId, answer: 1 }],
    });

    expect(status).toBe(409);
  });

  it("stores the EFN and returns no body", async () => {
    const { status, body } = await call("PUT", "/profile/efn", { efn: EFN });

    expect(status).toBe(204);
    expect(body).toBeUndefined();
  });

  it("completes and queues the Punktemeldung", async () => {
    // The Punktemeldung form as the layout draws it (page 13): title, given
    // name, family name and the consent, in one request. What gets printed and
    // reported is the *composed* name — `composeAttestedName` in @ds/domain is
    // the only place three fields become one string.
    const { status, body } = await call("POST", `/courses/${courseSlug}/completion`, {
      attestedTitle: "Dr. med.",
      attestedGivenName: "Anna",
      attestedFamilyName: "Müller",
      consentDocument: "datenschutz-2026-01",
    });

    expect(status).toBe(200);
    expect(body.complete).toBe(true);
    expect(body.outstanding).toEqual([]);
    expect(body.completedAt).not.toBeNull();

    const { rows } = await seedPool.query<{
      vnr: string;
      efn: string;
      status: string;
      report_due_at: Date;
      event_end_at: Date;
    }>(
      "SELECT vnr, efn, status, report_due_at, event_end_at FROM eiv_submissions WHERE enrolment_id = $1",
      [enrolmentId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.vnr).toBe(VNR);
    expect(rows[0]!.efn).toBe(EFN);
    expect(rows[0]!.status).toBe("queued");

    // The statutory 8-day reporting window, measured from completion.
    const days =
      (rows[0]!.report_due_at.getTime() - rows[0]!.event_end_at.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(8);
    expect(days).toBeLessThan(9);
  });

  it("is idempotent — completing again does not restart the reporting clock", async () => {
    const before = await seedPool.query<{ report_due_at: Date }>(
      "SELECT report_due_at FROM eiv_submissions WHERE enrolment_id = $1",
      [enrolmentId],
    );

    const { status } = await call("POST", `/courses/${courseSlug}/completion`);
    expect(status).toBe(200);

    const after = await seedPool.query<{ report_due_at: Date }>(
      "SELECT report_due_at FROM eiv_submissions WHERE enrolment_id = $1",
      [enrolmentId],
    );

    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.report_due_at).toEqual(before.rows[0]!.report_due_at);
  });

  it("never returns the EFN through any learner-facing endpoint", async () => {
    for (const path of [
      `/courses/${courseSlug}/enrolment`,
      `/courses/${courseSlug}/evaluation`,
    ]) {
      const { body } = await call("GET", path);
      expect(JSON.stringify(body)).not.toContain(EFN);
    }
  });
});

describe("the Teilnahmebescheinigung", () => {
  it("exposes the fields the Bescheid requires", async () => {
    const { status, body } = await call("GET", `/courses/${courseSlug}/certificate`);

    expect(status).toBe(200);
    expect(body.vnr).toBe(VNR);
    expect(body.cmePoints).toBe(4);
    expect(body.cmeCategory).toBe("D");
    expect(body.eventLocation).toBe("online");
    expect(body.scientificLeadName).toContain("Muster-Leitung");
    // The name the learner attested to, not the (absent) token profile name.
    expect(body.participantName).toBe(ATTESTED_NAME);
    // The participation date is the completion instant — for an on-demand
    // course there is no other date the certificate could mean.
    expect(body.completedAt).not.toBeNull();
  });

  it("templates the creditability sentence from the course's own values", async () => {
    const { body } = await call("GET", `/courses/${courseSlug}/certificate`);

    expect(body.creditSentence).toContain("4 Punkten (Kategorie D)");
    expect(body.creditSentence).toContain("Ärztekammer Westfalen-Lippe");
  });

  it("downloads a real PDF with the right headers", async () => {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setSubject(SUB)
      .setExpirationTime("5m")
      .sign(privateKey);

    const response = await fetch(`${baseUrl}/courses/${courseSlug}/certificate/pdf`, {
      headers: { authorization: `Bearer ${jwt}`, "x-ds-project": projectSlug },
    });

    // On failure the body is problem-details JSON — surfacing it here turns
    // "expected 409 to be 200" into the actual reason.
    if (response.status !== 200) {
      throw new Error(
        `certificate download failed: ${response.status} ${await response.text()}`,
      );
    }
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      "Teilnahmebescheinigung",
    );
    // A named physician's participation record must not sit in a shared cache.
    expect(response.headers.get("cache-control")).toContain("no-store");

    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    // Big enough to contain two barcodes and two images, not an error page.
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it("records the issue exactly once, with a high-entropy token", async () => {
    const { rows } = await seedPool.query<{ download_token: string; status: string }>(
      `SELECT download_token, status FROM certificates WHERE enrolment_id = $1`,
      [enrolmentId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("issued");
    // 32 bytes of CSPRNG, hex-encoded: this token is the capability to fetch a
    // named physician's record.
    expect(rows[0]!.download_token).toHaveLength(64);
  });

  it("does not mint a new token on a second download", async () => {
    const before = await seedPool.query<{ download_token: string }>(
      "SELECT download_token FROM certificates WHERE enrolment_id = $1",
      [enrolmentId],
    );

    await call("GET", `/courses/${courseSlug}/certificate`);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setSubject(SUB)
      .setExpirationTime("5m")
      .sign(privateKey);
    await fetch(`${baseUrl}/courses/${courseSlug}/certificate/pdf`, {
      headers: { authorization: `Bearer ${jwt}`, "x-ds-project": projectSlug },
    });

    const after = await seedPool.query<{ download_token: string }>(
      "SELECT download_token FROM certificates WHERE enrolment_id = $1",
      [enrolmentId],
    );

    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.download_token).toBe(before.rows[0]!.download_token);
  });
});

describe("the admin console sees the same truth the learner does", () => {
  it("reports the participant's figures exactly as the learner's own screen does", async () => {
    // CLAUDE.md §4 invariant 6. This is the assertion the invariant exists
    // for: a console telling MEDICE 96 % where the physician's own screen says
    // 100 % is two different answers to "did this person earn a CME point",
    // and one of them has already gone to the Ärztekammer.
    const learner = await call("GET", `/courses/${courseSlug}/enrolment`);
    const admin = await callAs(
      ADMIN_SUB,
      "GET",
      `/admin/courses/${courseSlug}/participants`,
    );

    expect(admin.status).toBe(200);
    const row = admin.body.rows.find(
      (entry: { enrolmentId: string }) => entry.enrolmentId === enrolmentId,
    );

    expect(row).toBeDefined();
    expect(row.watchedPercent).toBe(learner.body.achievedWatchPercent);
    expect(row.progressPercent).toBe(learner.body.progress.percent);
    expect(row.quizPassed).toBe(learner.body.quizPassed);
    expect(row.evaluationSubmitted).toBe(learner.body.evaluationSubmitted);
    expect(row.complete).toBe(learner.body.complete);
    expect(row.completedAt).toBe(learner.body.completedAt);
    expect(row.efnPresent).toBe(learner.body.efnPresent);
  });

  it("shows the attested name, and never the EFN", async () => {
    const { body } = await callAs(
      ADMIN_SUB,
      "GET",
      `/admin/courses/${courseSlug}/participants`,
    );

    const row = body.rows.find(
      (entry: { enrolmentId: string }) => entry.enrolmentId === enrolmentId,
    );
    expect(row.participantName).toBe(ATTESTED_NAME);
    expect(JSON.stringify(body)).not.toContain(EFN);
  });

  it("stores the name in its three parts beside the one that is reported", async () => {
    // Layout page 13 captures three fields; the certificate and the
    // Punktemeldung carry one string. Both are stored, and the database
    // refuses the state where the parts exist and the composed name does not
    // (`enrolments_attested_name_present`, migration 0024).
    const { rows } = await seedPool.query<{
      attested_name: string | null;
      attested_title: string | null;
      attested_given_name: string | null;
      attested_family_name: string | null;
    }>(
      `SELECT attested_name, attested_title, attested_given_name, attested_family_name
         FROM enrolments WHERE id = $1`,
      [enrolmentId],
    );

    expect(rows[0]).toEqual({
      attested_name: ATTESTED_NAME,
      attested_title: "Dr. med.",
      attested_given_name: "Anna",
      attested_family_name: "Müller",
    });
  });

  it("records the consent that authorised the Punktemeldung", async () => {
    // GDPR Art. 7(1). The version matters, not a boolean: consent to the
    // January wording is not consent to the June wording, and a record that
    // cannot tell them apart demonstrates only that somebody agreed to
    // something.
    const { rows } = await seedPool.query<{
      consent_given_at: Date | null;
      consent_document: string | null;
    }>(`SELECT consent_given_at, consent_document FROM enrolments WHERE id = $1`, [
      enrolmentId,
    ]);

    expect(rows[0]?.consent_document).toBe("datenschutz-2026-01");
    expect(rows[0]?.consent_given_at).toBeInstanceOf(Date);
  });

  it("reports the course as ready to issue certificates", async () => {
    const { status, body } = await callAs(
      ADMIN_SUB,
      "GET",
      `/admin/courses/${courseSlug}`,
    );

    expect(status).toBe(200);
    // The same rule the certificate endpoint enforces — and that endpoint has
    // already issued a PDF for this course above, so "ready" is provably true.
    expect(body.certificateReady).toBe(true);
    expect(body.missingCertificateFields).toEqual([]);
  });

  it("never returns the stamp bytes or the VNR password", async () => {
    const { body } = await callAs(ADMIN_SUB, "GET", `/admin/courses/${courseSlug}`);

    expect(body.hasStampImage).toBe(true);
    expect(body.hasSignatureImage).toBe(true);
    expect(JSON.stringify(body)).not.toContain('stampImage":"');
    expect(JSON.stringify(body)).not.toContain("vnrPassword");
    // And not the raw PNG, under any key.
    expect(JSON.stringify(body)).not.toContain(PLACEHOLDER_IMAGE.toString("base64"));
  });
});

describe("the admin surface is closed to a learner", () => {
  it("403s every admin route for a learner token", async () => {
    for (const path of [
      "/admin/courses",
      `/admin/courses/${courseSlug}`,
      `/admin/courses/${courseSlug}/participants`,
      `/admin/courses/${courseSlug}/participants.csv`,
    ]) {
      const { status } = await call("GET", path);
      expect(status).toBe(403);
    }
  });

  it("403s a course edit for a learner token", async () => {
    const { status } = await call("PATCH", `/admin/courses/${courseSlug}`, {
      certificateIssuePlace: "Nirgendwo",
    });
    expect(status).toBe(403);
  });

  it("leaves the course unchanged after the refused edit", async () => {
    // A 403 that still wrote would be the worst of both.
    const { rows } = await seedPool.query<{ certificate_issue_place: string }>(
      "SELECT certificate_issue_place FROM courses WHERE slug = $1",
      [courseSlug],
    );
    expect(rows[0]!.certificate_issue_place).toBe("Iserlohn");
  });
});

describe("the accreditation threshold, over HTTP", () => {
  it("refuses to lower it below the accredited minimum", async () => {
    const { status, body } = await callAs(
      ADMIN_SUB,
      "PATCH",
      `/admin/courses/${courseSlug}`,
      { passThresholdPercent: 40 },
    );

    expect(status).toBe(409);
    expect(body.detail).toContain("Anerkennungsbescheid");
  });

  it("did not write the refused value", async () => {
    const { rows } = await seedPool.query<{ pass_threshold_percent: number }>(
      "SELECT pass_threshold_percent FROM courses WHERE slug = $1",
      [courseSlug],
    );
    expect(rows[0]!.pass_threshold_percent).toBe(70);
  });

  it("accepts it with the acknowledgement, and audits that", async () => {
    const { status } = await callAs(ADMIN_SUB, "PATCH", `/admin/courses/${courseSlug}`, {
      passThresholdPercent: 40,
      acknowledgeAccreditationRisk: true,
    });
    expect(status).toBe(200);

    const { rows } = await seedPool.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM audit_log WHERE action = 'admin.course.update' ORDER BY id DESC LIMIT 1",
    );
    expect(rows[0]!.detail).toMatchObject({ accreditationRiskAcknowledged: true });

    // Put it back — later assertions in other suites read this course.
    await callAs(ADMIN_SUB, "PATCH", `/admin/courses/${courseSlug}`, {
      passThresholdPercent: 70,
    });
  });

  it("does not change an existing enrolment's snapshotted threshold", async () => {
    // P3-01: a learner who started under 70 % finishes under it. This is what
    // makes a threshold edit safe to allow at all.
    const { rows } = await seedPool.query<{ pass_threshold_percent: number }>(
      "SELECT pass_threshold_percent FROM enrolments WHERE id = $1",
      [enrolmentId],
    );
    expect(rows[0]!.pass_threshold_percent).toBe(70);
  });
});

describe("the CSV export", () => {
  it("returns a spreadsheet-safe file with the same rows as the list", async () => {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setSubject(ADMIN_SUB)
      .setExpirationTime("5m")
      .sign(privateKey);

    const response = await fetch(
      `${baseUrl}/admin/courses/${courseSlug}/participants.csv`,
      { headers: { authorization: `Bearer ${jwt}`, "x-ds-project": projectSlug } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toContain("no-store");

    // Read as bytes, not text: `Response.text()` decodes UTF-8 and strips the
    // BOM, so asserting on the string would silently pass with no BOM on the
    // wire — which is exactly the Excel bug this is meant to catch.
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));

    const csv = bytes.toString("utf8");
    expect(csv).toContain("sep=;");
    expect(csv).toContain(ATTESTED_NAME);
    // The EFN never leaves the system in a file.
    expect(csv).not.toContain(EFN);
  });

  it("audits the export, with a row count and no row content", async () => {
    const { rows } = await seedPool.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM audit_log WHERE action = 'admin.participants.export' ORDER BY id DESC LIMIT 1",
    );

    expect(rows[0]!.detail).toMatchObject({ format: "csv", rowCount: 1 });
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(ATTESTED_NAME);
  });
});

/**
 * The white-label font (P10-08).
 *
 * Three properties, and only the first is about typography:
 *
 * 1. An uploaded font round-trips — admin PUT, public GET, correct bytes.
 * 2. **The bytes decide the format.** Anything that is not a woff/woff2
 *    container is refused whatever it declares itself to be, because this file
 *    is served from our own origin to a page that holds a bearer token.
 * 3. The public routes disclose the font and nothing else on the project row.
 */
describe("the white-label font", () => {
  /** A minimal but structurally valid container: signature, self-consistent length. */
  function fontFile(signature: string, totalBytes = 64): Buffer {
    const bytes = Buffer.alloc(totalBytes);
    bytes.write(signature, 0, "ascii");
    bytes.writeUInt32BE(totalBytes, 8);
    return bytes;
  }

  /** The public routes take no token — that is the point of them. */
  async function publicGet(path: string, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}${path}`, { headers });
  }

  it("has no font before anybody uploads one", async () => {
    const { status, body } = await callAs(ADMIN_SUB, "GET", "/admin/branding/font");

    expect(status).toBe(200);
    expect(body).toEqual({ fontFamilyName: null, fontVersion: null, fontBytes: null });

    const file = await publicGet("/branding/font", { "x-ds-project": projectSlug });
    expect(file.status).toBe(404);
  });

  it("refuses a file that is not a font, however it is declared", async () => {
    // An SVG font is executable markup served from our origin — the one upload
    // that must never succeed. It is refused by its bytes, not its extension.
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`.padEnd(
        64,
        " ",
      ),
    );

    const { status } = await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: svg.toString("base64"),
      fontMime: "font/woff2",
      fontFamilyName: "Evil Sans",
    });

    expect(status).toBe(422);

    const { body } = await callAs(ADMIN_SUB, "GET", "/admin/branding/font");
    expect(body.fontFamilyName).toBeNull();
  });

  it("refuses a real font with data appended to it", async () => {
    // Valid woff2 to a font parser, something else to anything that keeps
    // reading. We serve this with a year-long cache; it must be exactly as
    // long as its own header claims.
    const polyglot = Buffer.concat([fontFile("wOF2", 64), Buffer.from("<html>")]);

    const { status } = await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: polyglot.toString("base64"),
      fontFamilyName: "Medice Sans",
    });

    expect(status).toBe(422);
  });

  it("refuses a family name that could break out of the @font-face block", async () => {
    const { status } = await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: fontFile("wOF2").toString("base64"),
      fontFamilyName: 'X"}body{display:none}@font-face{font-family:"Y',
    });

    expect(status).toBe(422);
  });

  it("stores a woff2 and serves it back to an anonymous browser", async () => {
    const uploaded = fontFile("wOF2", 96);

    const put = await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: uploaded.toString("base64"),
      fontMime: "font/woff2",
      fontFamilyName: "Medice Sans",
    });

    expect(put.status).toBe(200);
    expect(put.body.fontFamilyName).toBe("Medice Sans");
    expect(put.body.fontBytes).toBe(96);
    expect(typeof put.body.fontVersion).toBe("string");

    // Fetched with no token and no header but the project — the way a browser
    // loads a font from an `@font-face` rule.
    const file = await publicGet(
      `/branding/font?project=${projectSlug}&v=${encodeURIComponent(put.body.fontVersion)}`,
    );

    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("font/woff2");
    // Cross-origin by definition: the widget runs on the customer's WordPress.
    expect(file.headers.get("access-control-allow-origin")).toBe("*");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");

    expect(Buffer.from(await file.arrayBuffer()).equals(uploaded)).toBe(true);
  });

  it("accepts a font at a realistic size, not only a token one", async () => {
    // Every other assertion here uses a 64-byte font, which is why the body
    // limit went unnoticed: base64 inflates a 2 MB file to ~2.8 MB, the global
    // JSON limit is 1 MB, and the parser would have refused a real family with
    // an opaque 413 long before any German error message was produced. 1.5 MB
    // is a plausible unsubsetted family and does not fit under the global
    // limit, so this fails if the route-scoped one is ever removed.
    const large = fontFile("wOF2", 1_500_000);

    const { status, body } = await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: large.toString("base64"),
      fontFamilyName: "Medice Sans",
    });

    expect(status).toBe(200);
    expect(body.fontBytes).toBe(1_500_000);

    // Put the small one back so the byte-for-byte assertion above still
    // describes what is stored.
    await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: fontFile("wOF2", 96).toString("base64"),
      fontFamilyName: "Medice Sans",
    });
  });

  it("still refuses one over the column's own bound", async () => {
    // The route-scoped limit is 3 MB so a legitimate 2 MB file fits. The 2 MB
    // rule itself is enforced by the service and by a CHECK constraint, not by
    // the body parser — a larger limit must not become a larger allowance.
    const oversized = fontFile("wOF2", 2_200_000);

    const { status } = await callAs(ADMIN_SUB, "PUT", "/admin/branding/font", {
      fontBase64: oversized.toString("base64"),
      fontFamilyName: "Medice Sans",
    });

    expect(status).toBe(422);
  });

  it("names the font in the public branding, and nothing else from the row", async () => {
    const response = await publicGet("/branding", { "x-ds-project": projectSlug });
    const branding = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(branding["fontFamilyName"]).toBe("Medice Sans");
    expect(typeof branding["fontVersion"]).toBe("string");

    // The Keycloak binding and the SMTP settings live on the same row. This is
    // a public route, and the SQL function is what keeps them off it.
    const serialised = JSON.stringify(branding);
    expect(serialised).not.toContain("keycloak");
    expect(serialised).not.toContain("smtp");
    expect(serialised).not.toContain(issuer);
  });

  it("refuses the upload for a learner token", async () => {
    const { status } = await call("PUT", "/admin/branding/font", {
      fontBase64: fontFile("wOF2").toString("base64"),
      fontFamilyName: "Learner Sans",
    });

    expect(status).toBe(403);

    // And nothing was written.
    const { body } = await callAs(ADMIN_SUB, "GET", "/admin/branding/font");
    expect(body.fontFamilyName).toBe("Medice Sans");
  });

  it("removes it again", async () => {
    const { status, body } = await callAs(ADMIN_SUB, "DELETE", "/admin/branding/font");

    expect(status).toBe(200);
    expect(body).toEqual({ fontFamilyName: null, fontVersion: null, fontBytes: null });

    const file = await publicGet(`/branding/font?project=${projectSlug}`);
    expect(file.status).toBe(404);
  });
});

/**
 * GDPR Art. 17 erasure (P10-10), against the real schema.
 *
 * The property under test is a balance, not a deletion:
 *
 * - **Everything identifying goes.** Name, email, EFN, attested name, free-text
 *   evaluation answers, the name printed on the certificate.
 * - **The participation record stays.** Which course, which VNR, how many
 *   points, when it completed, that a Punktemeldung was made. Art. 17(3)(b):
 *   that record exists under a legal obligation, and deleting it would not
 *   honour a right, it would destroy the counterpart of a report already filed
 *   with the Ärztekammer.
 *
 * This suite runs last on purpose — it pseudonymises the learner every earlier
 * assertion in this file depends on.
 */
describe("erasure keeps the participation and removes the person", () => {
  /**
   * Erasure runs as `ds_migrator`. The API's own role cannot execute the
   * function at all, which is the point — see subject-erasure.ts.
   */
  async function eraseAs(role: "app" | "operator", userId: string) {
    const url =
      role === "operator"
        ? requireEnv("MIGRATION_DATABASE_URL")
        : requireEnv("DATABASE_URL");
    const pool = new Pool({ connectionString: url });
    try {
      return await pool.query("SELECT * FROM erase_subject($1, $2)", [userId, "test"]);
    } finally {
      await pool.end();
    }
  }

  let learnerId: string;

  beforeAll(async () => {
    // Scoped by realm as well as subject: every run of this suite starts its
    // JWKS server on a fresh port, so the issuer differs and the table
    // accumulates one `completion-learner` per run. Taking the first match
    // would pick an arbitrary previous run's user — one this suite has
    // already erased.
    const { rows } = await seedPool.query<{ user_id: string }>(
      "SELECT user_id FROM user_identities WHERE subject = $1 AND realm = $2",
      [SUB, issuer],
    );
    learnerId = rows[0]!.user_id;
  });

  /**
   * This assertion was the opposite until P12-05, and the reversal is
   * deliberate rather than a relaxation nobody noticed.
   *
   * The original reasoning was good: `ds_app` runs every HTTP request, so
   * granting it this makes a bug in any controller an erasure primitive. What
   * it cost was that the only way to honour a GDPR Art. 17 request was for
   * somebody with migration credentials to run the function by hand — a subject
   * right that depends on a DBA being available on the day is not much of a
   * right, and Art. 12(3) puts a month on it.
   *
   * What makes the grant defensible is that the dangerous parts are *inside*
   * the function and are not granted with it. `ds_app` gains no BYPASSRLS and
   * no privilege on any table the body touches; `SECURITY DEFINER` runs it as
   * `ds_erasure`, whose grants are narrower than `ds_app`'s own. The function
   * refuses while a Punktemeldung is open, pseudonymises rather than deleting
   * so the CME record survives, and writes its own audit row. The blast radius
   * of the worst case is one subject per call, rate-limited to five per five
   * minutes, every one of them audited twice.
   *
   * **This is a change of security posture and is marked for human review**
   * (see docs/show-stoppers.md S18).
   */
  it("is available to the API's own database role, deliberately (P12-05)", async () => {
    // The privilege, not the effect. Actually erasing here would consume the
    // subject the rest of this block is about — and the posture is what
    // changed, so the posture is what this asserts.
    const { rows } = await seedPool.query<{ granted: boolean }>(
      "SELECT has_function_privilege('ds_app', 'erase_subject(uuid,text)', 'EXECUTE') AS granted",
    );
    expect(rows[0]?.granted).toBe(true);
  });

  /**
   * Force the subject's Punktemeldung into a given state.
   *
   * `next_attempt_at` is pushed an hour out at the same time, and that is not
   * incidental. The worker suite shares this database and its scheduler sweeps
   * every due submission, not only its own — so a row left `queued` with a due
   * attempt gets picked up and moved to a terminal state between this update
   * and the assertion that follows. A submission scheduled for a later attempt
   * is still an open one, so the test loses nothing by saying so explicitly.
   */
  async function setSubmissionStatus(status: string): Promise<void> {
    const { rowCount } = await seedPool.query(
      `UPDATE eiv_submissions
       SET status = $2, next_attempt_at = now() + interval '1 hour'
       WHERE enrolment_id IN (SELECT id FROM enrolments WHERE user_id = $1)`,
      [learnerId, status],
    );
    // The completion above created exactly one. If it did not, the assertions
    // below would be testing nothing.
    expect(rowCount).toBeGreaterThan(0);
  }

  it("previews what the erasure will actually do, not what RLS lets it see", async () => {
    // The dry run is what a human reads before typing --confirm. Built with
    // plain SELECTs on the operator's connection it reported zero for every
    // tenant-scoped count — "0 enrolments" for a subject with one, and "0 open
    // Punktemeldungen" for a subject whose report was in flight. Both readings
    // lead somewhere bad: a lawful request goes unactioned, or an operator
    // confirms an erasure that then refuses. Migration 0010 gives the preview
    // the same visibility as the erasure.
    await setSubmissionStatus("queued");

    const pool = new Pool({ connectionString: requireEnv("MIGRATION_DATABASE_URL") });
    try {
      const { rows } = await pool.query<{
        enrolments: number;
        open_submissions: number;
      }>("SELECT * FROM preview_subject_erasure($1)", [learnerId]);

      expect(rows[0]!.enrolments).toBeGreaterThan(0);
      // And it agrees with the refusal below, which is the whole point.
      expect(rows[0]!.open_submissions).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }

    await expect(eraseAs("operator", learnerId)).rejects.toThrow(/still open/i);
  });

  it.each(["queued", "held", "failed_retryable"])(
    "refuses while a Punktemeldung is %s",
    async (status) => {
      // Set here rather than read: the worker suite shares this database and
      // decides for itself how far a submission gets. The property under test
      // is the refusal, not what some other suite happened to leave behind —
      // and the earlier version of this test failed in CI for exactly that
      // reason, having passed locally.
      //
      // The EFN is the key the Ärztekammer credits points against. Removing it
      // while a report is in flight leaves one that can neither be completed
      // nor corrected, and the correction window closes permanently.
      await setSubmissionStatus(status);

      await expect(eraseAs("operator", learnerId)).rejects.toThrow(/still open/i);
    },
  );

  it("erases once the reporting window has closed", async () => {
    await setSubmissionStatus("submitted");

    const { rows } = await eraseAs("operator", learnerId);
    expect(Number(rows[0]!.enrolments_pseudonymised)).toBeGreaterThan(0);
  });

  it("leaves no identifier behind", async () => {
    const { rows } = await seedPool.query<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      erased_at: Date | null;
      attested_name: string | null;
      attested_title: string | null;
      attested_given_name: string | null;
      attested_family_name: string | null;
      consent_document: string | null;
      efn: string;
      participant_name: string;
      efn_profiles: string;
    }>(
      `SELECT u.email, u.first_name, u.last_name, u.erased_at,
              e.attested_name, e.attested_title, e.attested_given_name,
              e.attested_family_name, e.consent_document,
              s.efn, c.participant_name,
              (SELECT count(*) FROM efn_profiles p WHERE p.user_id = u.id) AS efn_profiles
       FROM users u
       JOIN enrolments e ON e.user_id = u.id
       JOIN eiv_submissions s ON s.enrolment_id = e.id
       JOIN certificates c ON c.enrolment_id = e.id
       WHERE u.id = $1`,
      [learnerId],
    );

    const row = rows[0]!;
    expect(row.email).toBeNull();
    expect(row.first_name).toBeNull();
    expect(row.last_name).toBeNull();
    expect(row.erased_at).not.toBeNull();
    expect(row.attested_name).toBeNull();
    // The parts too. An erasure routine that clears the composed name and
    // leaves the three columns it was composed from is the most predictable
    // failure this schema has, and it fails silently — the request succeeds,
    // the report says rows were cleared, and the name is still in the row.
    expect(row.attested_title).toBeNull();
    expect(row.attested_given_name).toBeNull();
    expect(row.attested_family_name).toBeNull();
    // The consent record survives, deliberately: Art. 17(3)(b) and (e), and it
    // names nobody once the name and the EFN are gone. It is the only answer
    // to "was this report authorised?" once the report itself is all that is
    // left.
    expect(row.consent_document).toBe("datenschutz-2026-01");
    expect(row.participant_name).not.toBe(ATTESTED_NAME);
    expect(Number(row.efn_profiles)).toBe(0);
    // The submission row survives as evidence a report was made; the
    // identifier in it does not.
    expect(row.efn).not.toBe(EFN);
  });

  it("keeps the participation record intact", async () => {
    const { rows } = await seedPool.query<{
      vnr: string;
      cme_points: number;
      completed_at: Date;
      status: string;
    }>(
      `SELECT e.vnr, e.cme_points, e.completed_at, s.status
       FROM enrolments e JOIN eiv_submissions s ON s.enrolment_id = e.id
       WHERE e.user_id = $1`,
      [learnerId],
    );

    const row = rows[0]!;
    expect(row.vnr).toBe(VNR);
    expect(row.cme_points).toBe(4);
    expect(row.completed_at).not.toBeNull();
    expect(row.status).toBe("submitted");
  });

  it("does not let a later sign-in write the profile back", async () => {
    // `provisionOrUpdate` writes name and email from the token on every single
    // request. Without the trigger, an erased subject signing in once would
    // silently undo the erasure, as a side effect of a normal request.
    const { status } = await call("GET", `/courses/${courseSlug}/enrolment`);
    expect(status).toBe(200);

    const { rows } = await seedPool.query<{ email: string | null; erased_at: Date }>(
      "SELECT email, erased_at FROM users WHERE id = $1",
      [learnerId],
    );

    expect(rows[0]!.email).toBeNull();
    expect(rows[0]!.erased_at).not.toBeNull();
  });

  it("records the erasure without recording who it was", async () => {
    const { rows } = await seedPool.query<{ detail: Record<string, unknown> }>(
      "SELECT detail FROM audit_log WHERE action = 'gdpr.subject.erased' AND subject = $1",
      [learnerId],
    );

    expect(rows).toHaveLength(1);
    // Art. 19 needs the erasure to be provable. An audit row quoting the erased
    // name would be the one place the name survived.
    const serialised = JSON.stringify(rows[0]!.detail);
    expect(serialised).not.toContain(ATTESTED_NAME);
    expect(serialised).not.toContain(EFN);
  });

  it("answers a repeated request instead of running twice", async () => {
    const { rows } = await eraseAs("operator", learnerId);
    expect(Number(rows[0]!.enrolments_pseudonymised)).toBe(0);
  });
});
