/**
 * The learner journey end to end (P3), against a real Postgres with RLS on and
 * the real `AppModule` booted — no mocks anywhere below the HTTP call.
 *
 * What this proves that the unit tests cannot: that the gate, the interval
 * union and the progress rollup survive the round trip through the database.
 * The service tests run against a fake repository, so they prove the rules are
 * composed correctly; only this suite proves the `jsonb` segment column, the
 * `ON CONFLICT` upsert and the RLS-scoped reads behave as the rules assume.
 *
 * The scenario mirrors the layout: two modules, the second locked until the
 * first is finished, a video in each, and a quiz at the end.
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

const KID = "learning-flow-key";
const AUDIENCE = "ds-education-api";
const SUB = "learner-sub";

const VIDEO_1_SEC = 600;
const VIDEO_2_SEC = 400;
/** Distinctive so a leak anywhere in a payload is greppable. */
const VIDEO_1_URL = "https://cdn.example.org/lf-modul-1.mp4";
const VIDEO_2_URL = "https://cdn.example.org/lf-modul-2-locked.mp4";

let jwksServer: Server;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

let projectSlug: string;
let courseSlug: string;
let video1Id: string;
let video2Id: string;
let quizId: string;

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/learning-flow`;

  const suffix = randomUUID().slice(0, 8);
  projectSlug = `lf-project-${suffix}`;
  courseSlug = `lf-course-${suffix}`;

  const customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`lf-customer-${suffix}`, "Learning Flow GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "LF project", issuer, AUDIENCE],
  );
  const courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent, pass_threshold_percent)
     VALUES ($1,$2,$3,$4,100,70) RETURNING id`,
    [customerId, projectId, courseSlug, "Learning flow course"],
  );

  // Module 1 → chapter 1 → video (600 s); module 2 → chapter 2 → video (400 s) + quiz.
  const module1 = await insert(
    "INSERT INTO modules (customer_id, course_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, courseId, "Modul 1 – Grundlagen"],
  );
  const module2 = await insert(
    "INSERT INTO modules (customer_id, course_id, ordinal, title) VALUES ($1,$2,1,$3) RETURNING id",
    [customerId, courseId, "Modul 2 – Diagnostik"],
  );
  const chapter1 = await insert(
    "INSERT INTO chapters (customer_id, module_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, module1, "Kapitel 1"],
  );
  const chapter2 = await insert(
    "INSERT INTO chapters (customer_id, module_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, module2, "Kapitel 2"],
  );
  video1Id = await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, video_url)
     VALUES ($1,$2,0,'video',$3,$4,$5) RETURNING id`,
    [customerId, chapter1, "Einführung", VIDEO_1_SEC, VIDEO_1_URL],
  );
  video2Id = await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, video_url)
     VALUES ($1,$2,0,'video',$3,$4,$5) RETURNING id`,
    [customerId, chapter2, "Diagnostik", VIDEO_2_SEC, VIDEO_2_URL],
  );
  quizId = await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title)
     VALUES ($1,$2,1,'quiz',$3) RETURNING id`,
    [customerId, chapter2, "Lernerfolgskontrolle"],
  );

  // Mediathek downloads, one per module, to exercise the padlock.
  await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, file_url, mime_type, file_size)
     VALUES ($1,$2,9,'material',$3,$4,'application/pdf',1024) RETURNING id`,
    [customerId, chapter1, "Modul 1 Handout", "https://cdn.example.org/m1.pdf"],
  );
  await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, file_url, mime_type, file_size)
     VALUES ($1,$2,9,'material',$3,$4,'application/pdf',2048) RETURNING id`,
    [customerId, chapter2, "Modul 2 Handout", "https://cdn.example.org/m2.pdf"],
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

async function token(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(SUB)
    .setExpirationTime("5m")
    .sign(privateKey);
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await token()}`,
      "x-ds-project": projectSlug,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

/**
 * Rewrites the stored `updated_at` backwards so the next report's wall-clock
 * budget is generous. Without this the anti-tampering rule would (correctly)
 * reject a test that plays ten minutes of video in a few milliseconds.
 */
async function backdateProgress(seconds: number): Promise<void> {
  await seedPool.query(
    `UPDATE content_progress SET updated_at = now() - ($1 || ' seconds')::interval`,
    [String(seconds)],
  );
}

describe("the learner journey", () => {
  it("enrols idempotently, snapshotting the course's settings", async () => {
    const first = await call("PUT", `/courses/${courseSlug}/enrolment`);
    expect(first.status).toBe(200);
    expect(first.body.requiredWatchPercent).toBe(100);
    expect(first.body.passThresholdPercent).toBe(70);

    const second = await call("PUT", `/courses/${courseSlug}/enrolment`);
    expect(second.status).toBe(200);
    expect(second.body.enrolmentId).toBe(first.body.enrolmentId);
  });

  it("starts with module 2 locked and everything outstanding", async () => {
    const { status, body } = await call("GET", `/courses/${courseSlug}/enrolment`);

    expect(status).toBe(200);
    expect(body.modules).toHaveLength(2);
    expect(body.modules[0].gate).toBe("available");
    expect(body.modules[1].gate).toBe("locked");
    expect(body.moduleCompletion).toEqual({ completed: 0, total: 2 });
    expect(body.outstanding).toEqual(["watch", "quiz", "evaluation", "efn"]);
    expect(body.resumeContentId).toBe(video1Id);
  });

  it("serves the first lesson's video URL, which is reachable", async () => {
    const { status, body } = await call(
      "GET",
      `/courses/${courseSlug}/contents/${video1Id}`,
    );

    expect(status).toBe(200);
    expect(body.videoUrl).toBe(VIDEO_1_URL);
    expect(body.kind).toBe("video");
    expect(body.durationSec).toBe(VIDEO_1_SEC);
  });

  it("withholds the locked lesson's video URL entirely", async () => {
    // The whole reason `GET /contents/{id}` exists. A 403 with no body is the
    // gate; returning the URL and trusting the client to hide it would not be.
    const { status, body } = await call(
      "GET",
      `/courses/${courseSlug}/contents/${video2Id}`,
    );

    expect(status).toBe(403);
    expect(JSON.stringify(body)).not.toContain(VIDEO_2_URL);
  });

  it("keeps every URL out of the ungated browse response", async () => {
    // Both padlocks depend on this. `GET /courses/{slug}` is readable by any
    // holder of a tenant token, finished or not — a URL in it is a URL with no
    // gate in front of it, whatever the Mediathek and the player do later.
    //
    // This is a regression test for a real bypass: the catalog returned
    // `fileUrl` on every content row, so every Mediathek download was
    // reachable while its module was still padlocked.
    const { body } = await call("GET", `/courses/${courseSlug}`);
    const payload = JSON.stringify(body);

    expect(payload).not.toContain(VIDEO_1_URL);
    expect(payload).not.toContain(VIDEO_2_URL);
    expect(payload).not.toContain("https://cdn.example.org/m1.pdf");
    expect(payload).not.toContain("https://cdn.example.org/m2.pdf");
  });

  it("refuses to open a quiz as a lesson", async () => {
    // The quiz has its own endpoint, whose shape cannot carry a correct
    // answer. Routing it through the lesson endpoint would mean maintaining
    // that guarantee in two places.
    const { status } = await call("GET", `/courses/${courseSlug}/contents/${quizId}`);

    expect(status).toBe(422);
  });

  it("refuses progress against the locked second module", async () => {
    // The gate is an API property, not a UI one: posting straight at module 2
    // must not walk around the sequence.
    const { status } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video2Id}/progress`,
      { segments: [{ startSec: 0, endSec: 10 }] },
    );

    expect(status).toBe(403);
  });

  it("counts the union of watched intervals, not the furthest position", async () => {
    // Watching 0–60 then seeking to 540–600 leaves 480 s unwatched, even though
    // the playhead reached the end. A max-position implementation would call
    // this 100 %.
    const { status, body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      {
        segments: [
          { startSec: 0, endSec: 60 },
          { startSec: 540, endSec: 600 },
        ],
        lastPositionSec: 600,
      },
    );

    expect(status).toBe(200);
    expect(body.watchedPercent).toBe(20);
    expect(body.status).toBe("in_progress");
  });

  it("merges later intervals into the stored union across requests", async () => {
    await backdateProgress(VIDEO_1_SEC * 2);

    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      { segments: [{ startSec: 60, endSec: 540 }] },
    );

    // 0–60, 60–540 and 540–600 collapse to one interval covering the whole video.
    expect(body.watchedPercent).toBe(100);
    expect(body.status).toBe("completed");
  });

  it("names a segment that claims more playback than wall-clock allows", async () => {
    // The stored row was just written, so the budget is near zero: ten minutes
    // of freshly-claimed playback is not plausible and is rejected by name.
    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      { segments: [{ startSec: 0, endSec: 600 }] },
    );

    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].reason).toBe("faster_than_wallclock");
  });

  it("unlocks module 2 and moves the resume target once module 1 is complete", async () => {
    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);

    expect(body.modules[0].gate).toBe("completed");
    expect(body.modules[1].gate).toBe("available");
    expect(body.moduleCompletion).toEqual({ completed: 1, total: 2 });
    expect(body.resumeContentId).toBe(video2Id);

    // 600 of the course's 1000 video seconds — weighted by duration, not
    // averaged per video.
    expect(body.achievedWatchPercent).toBe(60);
  });

  it("accepts progress on module 2 now that it is reachable", async () => {
    await backdateProgress(VIDEO_2_SEC * 2);

    const { status, body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video2Id}/progress`,
      { segments: [{ startSec: 0, endSec: VIDEO_2_SEC }] },
    );

    expect(status).toBe(200);
    expect(body.watchedPercent).toBe(100);
  });

  it("reaches 100 % coverage but still withholds completion", async () => {
    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);

    expect(body.achievedWatchPercent).toBe(100);
    expect(body.complete).toBe(false);
    // Watching everything is not passing: quiz, evaluation and EFN remain.
    expect(body.outstanding).toEqual(["quiz", "evaluation", "efn"]);
    expect(body.resumeContentId).toBe(quizId);
  });

  it("refuses watch progress against a quiz", async () => {
    const { status } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${quizId}/progress`,
      { segments: [{ startSec: 0, endSec: 10 }] },
    );

    expect(status).toBe(422);
  });

  it("rejects a structurally invalid report without touching stored progress", async () => {
    const before = await call("GET", `/courses/${courseSlug}/enrolment`);

    const { status } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      { segments: [{ startSec: "nonsense", endSec: 5 }] },
    );

    expect(status).toBe(422);

    const after = await call("GET", `/courses/${courseSlug}/enrolment`);
    expect(after.body.achievedWatchPercent).toBe(before.body.achievedWatchPercent);
  });

  it("404s content belonging to another course", async () => {
    const { status } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${randomUUID()}/progress`,
      { segments: [] },
    );

    expect(status).toBe(404);
  });

  it("never leaks an answer key or an EFN through the state resource", async () => {
    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);
    const serialised = JSON.stringify(body);

    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("is_correct");
    expect(serialised).not.toMatch(/\d{15}/);
  });
});

describe("the Mediathek", () => {
  it("locks every download and withholds its URL before anything is finished", async () => {
    // Asserted at the very start of the suite's state would be ideal, but the
    // journey above has already completed module 1 — so this checks module 2,
    // which is still unfinished at this point.
    const { status, body } = await call("GET", `/courses/${courseSlug}/materials`);

    expect(status).toBe(200);
    const locked = body.groups.find((g: any) => g.locked === true);
    expect(locked).toBeDefined();
    expect(locked.materials[0].fileUrl).toBeNull();
    // The title survives so the padlocked row still has a label.
    expect(locked.materials[0].title).toContain("Handout");
  });

  it("releases module 1's download, whose content is complete", async () => {
    const { body } = await call("GET", `/courses/${courseSlug}/materials`);

    const unlocked = body.groups.find((g: any) => g.locked === false);
    expect(unlocked).toBeDefined();
    expect(unlocked.materials[0].fileUrl).toBe("https://cdn.example.org/m1.pdf");
  });

  it("leaks no locked URL anywhere in the payload", async () => {
    // The gate is the absent URL, so the locked module's file must not appear
    // at all — not in another field, not in a sibling group.
    const { body } = await call("GET", `/courses/${courseSlug}/materials`);

    expect(JSON.stringify(body)).not.toContain("m2.pdf");
  });

  it("does not let a download block its chapter from completing", async () => {
    // A PDF has no completion event. If it counted as a step, module 1 could
    // never finish and module 2 would stay locked forever.
    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);

    expect(body.modules[0].gate).toBe("completed");
  });
});
