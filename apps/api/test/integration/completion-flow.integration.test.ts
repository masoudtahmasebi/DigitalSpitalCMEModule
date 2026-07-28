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
// The submission worker has its own suite; leaving it sweeping here would
// mutate eiv_submissions rows underneath these assertions.
process.env["EIV_WORKER_ENABLED"] = "no";

const KID = "completion-flow-key";
const AUDIENCE = "ds-education-api";
const SUB = "completion-learner";
const VNR = "2760552025919300018";
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
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec)
     VALUES ($1,$2,0,'video',$3,$4) RETURNING id`,
    [customerId, chapterId, "Lektion", VIDEO_SEC],
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

  const userId = await insert(
    `INSERT INTO users (keycloak_realm, keycloak_sub, email, first_name, last_name)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [issuer, SUB, "learner@example.org", "Anna", "Müller"],
  );
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [userId, customerId],
  );

  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
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
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(SUB)
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
    // The learner confirms the name that will print on the certificate — the
    // Keycloak profile is pre-filled but editable (requirements §6.5).
    const { status, body } = await call("POST", `/courses/${courseSlug}/completion`, {
      attestedName: ATTESTED_NAME,
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
      throw new Error(`certificate download failed: ${response.status} ${await response.text()}`);
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
