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
import { expectNoAnswerKey } from "../support/answer-leak.js";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
import { publishAccredited } from "./support/accredited-course.js";

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
/**
 * Unique per run. A credential is keyed on `(provider, realm, subject)` and the
 * realm here is this run's ephemeral JWKS URL — which the OS will happily hand
 * back to a later run on the same port. A fixed subject then collides with the
 * previous run's row and the whole suite fails in `beforeAll`, which only
 * happens when a port is reused and is therefore never reproducible.
 */
const SUB = `learner-sub-${randomUUID().slice(0, 8)}`;

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
/* Hoisted for the P167-01 block below, which builds a course of its own. */
let customerId: string;
let projectId: string;
let suffixForTests: string;
/** A course awarding no CME points — see the suite at the end of this file. */
let freeCourseSlug: string;
let freeVideoId: string;
let video1Id: string;
let video2Id: string;
let quizId: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/learning-flow`;

  const suffix = randomUUID().slice(0, 8);
  projectSlug = `lf-project-${suffix}`;
  courseSlug = `lf-course-${suffix}`;

  suffixForTests = suffix;
  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`lf-customer-${suffix}`, "Learning Flow GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "LF project", issuer, AUDIENCE],
  );
  const courseId = await insert(
    // 4 CME points, which is what makes the EFN a condition of completion: a
    // course awarding none reports nothing to EIV-FOBI and so needs no EFN.
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent, pass_threshold_percent, cme_points, status)
     VALUES ($1,$2,$3,$4,100,70,4,'draft') RETURNING id`,
    [customerId, projectId, courseSlug, "Learning flow course"],
  );
  // Draft first, then furnished and published: a course awarding points cannot
  // be `published` and missing its VNR, stamp or signature (P62-02).
  await publishAccredited(seedPool, courseId);

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
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, media_sources)
     VALUES ($1,$2,0,'video',$3,$4,$5::jsonb) RETURNING id`,
    [
      customerId,
      chapter1,
      "Einführung",
      VIDEO_1_SEC,
      JSON.stringify([{ url: VIDEO_1_URL, mimeType: "video/mp4", label: null }]),
    ],
  );
  video2Id = await insert(
    // Two renditions, so the suite covers the ordering the browser relies on.
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, media_sources)
     VALUES ($1,$2,0,'video',$3,$4,$5::jsonb) RETURNING id`,
    [
      customerId,
      chapter2,
      "Diagnostik",
      VIDEO_2_SEC,
      JSON.stringify([
        {
          url: `${VIDEO_2_URL}?hls`,
          mimeType: "application/vnd.apple.mpegurl",
          label: null,
        },
        { url: VIDEO_2_URL, mimeType: "video/mp4", label: "720p" },
      ]),
    ],
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

  /*
   * A second course in the same project, awarding **no** CME points.
   *
   * Educational material without accreditation is a real case — the client has
   * asked for it explicitly — and it changes what completion means: with no
   * points there is nothing to report to EIV-FOBI, so there is nothing an EFN
   * would identify, and demanding one would collect a physician's identifier
   * for no purpose (ADR-0004). One module, one video: this fixture exists to
   * exercise the conditional, not the structure.
   */
  freeCourseSlug = `lf-free-${suffix}`;
  const freeCourseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent, pass_threshold_percent, cme_points, status)
     VALUES ($1,$2,$3,$4,100,70,NULL,'published') RETURNING id`,
    [customerId, projectId, freeCourseSlug, "Fortbildung ohne Punkte"],
  );
  const freeModule = await insert(
    "INSERT INTO modules (customer_id, course_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, freeCourseId, "Modul 1"],
  );
  const freeChapter = await insert(
    "INSERT INTO chapters (customer_id, module_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
    [customerId, freeModule, "Kapitel 1"],
  );
  freeVideoId = await insert(
    `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, duration_sec, media_sources)
     VALUES ($1,$2,0,'video',$3,60,$4::jsonb) RETURNING id`,
    [
      customerId,
      freeChapter,
      "Einführung",
      JSON.stringify([{ url: VIDEO_1_URL, mimeType: "video/mp4", label: null }]),
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
 * Moves the learner's clock backwards so the next report has wall-clock budget
 * to spend. Without it the anti-tampering rule would (correctly) reject a test
 * that plays ten minutes of video in a few milliseconds.
 *
 * **Both timestamps, since P55-01.** The budget is measured from the newest
 * `content_progress.updated_at` *or*, when the learner has touched nothing
 * yet, from `enrolments.created_at` — so moving only the first left every
 * first-report case with a budget of zero. That is the rule working: this
 * helper exists precisely to pretend time has passed, and it now has to
 * pretend consistently.
 */
async function backdateProgress(seconds: number): Promise<void> {
  const interval = `($1 || ' seconds')::interval`;
  await seedPool.query(`UPDATE content_progress SET updated_at = now() - ${interval}`, [
    String(seconds),
  ]);
  await seedPool.query(
    `UPDATE enrolments SET created_at = now() - ${interval}
      WHERE course_id IN (SELECT id FROM courses WHERE slug = ANY($2))`,
    [String(seconds), [courseSlug, freeCourseSlug]],
  );
}

describe("the learner journey", () => {
  it("enrols idempotently, and reports the course's settings", async () => {
    const first = await call("PUT", `/courses/${courseSlug}/enrolment`);
    expect(first.status).toBe(200);
    expect(first.body.requiredWatchPercent).toBe(100);
    expect(first.body.passThresholdPercent).toBe(70);

    const second = await call("PUT", `/courses/${courseSlug}/enrolment`);
    expect(second.status).toBe(200);
    expect(second.body.enrolmentId).toBe(first.body.enrolmentId);
  });

  it("follows the course's thresholds when an operator changes them", async () => {
    /*
     * P174-01. The client's decision: *"the three gating thresholds —
     * required_watch_percent, pass_threshold_percent, max_quiz_attempts should
     * come from the course."*
     *
     * Before it, the enrolment's copy decided, and the Zertifizierung tab —
     * which renders the course's numbers — disagreed with the progress card
     * beside it the moment a published course was edited. Two rules on one
     * screen for the one thing a physician is being held to.
     *
     * The snapshot columns are deliberately left untouched and asserted so: the
     * enrolment still records what was in force when this learner enrolled,
     * which is the evidence. It is simply no longer the rule.
     */
    await seedPool.query(
      `UPDATE courses SET required_watch_percent = 60, pass_threshold_percent = 90
        WHERE slug = $1`,
      [courseSlug],
    );

    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);

    expect(body.requiredWatchPercent).toBe(60);
    expect(body.passThresholdPercent).toBe(90);

    const { rows } = await seedPool.query<{ watch: number; pass: number }>(
      `SELECT e.required_watch_percent AS watch, e.pass_threshold_percent AS pass
         FROM enrolments e JOIN courses c ON c.id = e.course_id
        WHERE c.slug = $1`,
      [courseSlug],
    );
    expect(rows[0]?.watch).toBe(100);
    expect(rows[0]?.pass).toBe(70);

    await seedPool.query(
      `UPDATE courses SET required_watch_percent = 100, pass_threshold_percent = 70
        WHERE slug = $1`,
      [courseSlug],
    );
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

  it("serves the first lesson's sources, which are reachable", async () => {
    const { status, body } = await call(
      "GET",
      `/courses/${courseSlug}/contents/${video1Id}`,
    );

    expect(status).toBe(200);
    expect(body.sources).toEqual([
      { url: VIDEO_1_URL, mimeType: "video/mp4", label: null },
    ]);
    expect(body.kind).toBe("video");
    expect(body.durationSec).toBe(VIDEO_1_SEC);
  });

  it("returns the merged coverage the percentage was computed from", async () => {
    // The player's scrub bar draws these. Sending the number without the
    // intervals would leave the bar to accumulate its own, and it would then
    // shade passages the server rejected as implausible.
    const { body } = await call("GET", `/courses/${courseSlug}/contents/${video1Id}`);
    expect(Array.isArray(body.watchedSegments)).toBe(true);
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

  it("credits a drag to the end as the seconds it claims, not as the position", async () => {
    /*
     * INVARIANT A, in the shape a scrub bar produces (QA audit §2.2, P137-01).
     *
     * The union test below reaches the same conclusion from two intervals. This
     * one is the *first* update against an untouched video and it is a single
     * fragment at the very end — which is what a client sends when somebody
     * drags the bar to 09:55 and lets it run. A max-position implementation
     * calls that 99 %; the union says five seconds of six hundred, which floors
     * to zero.
     *
     * Worth its own case because the two are not the same code path in a naive
     * implementation: "furthest point reached" and "sum of intervals" agree on
     * a learner who watches from the start and diverge completely here.
     *
     * The server accepts the segment — five seconds of playback is plausible —
     * and that is the point. Nothing needs to refuse the *report*; what must
     * not happen is the report being worth more than the seconds in it.
     */
    await backdateProgress(VIDEO_1_SEC * 2);

    const { status, body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      {
        segments: [{ startSec: VIDEO_1_SEC - 5, endSec: VIDEO_1_SEC }],
        lastPositionSec: VIDEO_1_SEC,
      },
    );

    expect(status).toBe(200);
    expect(body.watchedPercent).toBe(0);
    expect(body.status).not.toBe("completed");
  });

  it("ignores a watchedPercent the client sends for itself", async () => {
    /*
     * INVARIANT C (QA audit §2.5, P137-01). The client sends intervals; the
     * server decides the percentage.
     *
     * Structurally this cannot happen — `progressReportSchema` has no such
     * field and zod strips what it does not name — and that is exactly why it
     * is asserted rather than assumed. The property is one `.passthrough()` or
     * one convenience field away from being untrue, and nothing else in the
     * suite would notice: every other case sends a well-formed body.
     */
    await backdateProgress(VIDEO_1_SEC * 2);

    const { status, body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      {
        segments: [{ startSec: 0, endSec: 5 }],
        watchedPercent: 100,
        status: "completed",
      },
    );

    expect(status).toBe(200);
    /*
     * Five seconds of a ten-minute video: 0 %, and emphatically not the
     * hundred the client asked for.
     *
     * It used to be five seconds *plus* the five the drag case above left at
     * the tail. Since P168-01 that fragment is refused rather than stored — it
     * began 595 s past anything this enrolment had watched — so the union here
     * is the five seconds from the start and the status that follows from them.
     */
    expect(body.watchedPercent).toBeLessThan(5);
    expect(body.status).not.toBe("completed");
  });

  it("counts the union of watched intervals, not the furthest position", async () => {
    // A learner who has been in this course a while (P55-01): the wall-clock
    // budget is measured from their last activity, and these cases report more
    // playback than the milliseconds this suite actually takes.
    await backdateProgress(VIDEO_1_SEC * 2);

    /*
     * Watching 0–60 and then reporting 540–600 claims the playhead reached the
     * end with 480 s unwatched. A max-position implementation calls that 100 %.
     *
     * Since P168-01 the second interval does not even get as far as the union:
     * it begins 480 s past the furthest point the record reaches, which is a
     * forward seek the player refuses and the server now refuses too. What the
     * test is about is unchanged and the answer is stronger — the reported
     * position buys nothing, and now neither does the fragment at it.
     */
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
    expect(body.rejected).toEqual([
      { segment: { startSec: 540, endSec: 600 }, reason: "beyond_ceiling" },
    ]);
    // 60 s of a 600 s video. The figure is a fraction of the **video**
    // (P94-01), so the tail grace does not move it — it only decides whether
    // there is anything left to watch, and here there are 540 s. A
    // max-position implementation would say 100.
    expect(body.watchedPercent).toBe(10);
    expect(body.status).toBe("in_progress");
    // The seek ceiling comes back with the union it was computed from — the
    // end of what was actually watched (600), plus the tolerance. It is
    // derived from the segments, never from `lastPositionSec`: a ceiling taken
    // from the reported position would let a client raise its own limit by
    // claiming to have arrived somewhere it never played.
    // 60.5, not 600.5 and not 605: half a second above the watched edge since
    // P154-01, because five seconds was exactly the forward key's step and let
    // it walk through unwatched content. The property this test is about — the
    // ceiling follows the union, not the reported position — is unchanged, and
    // the union now ends at 60.
    expect(body.seekCeilingSec).toBe(60.5);
  });

  it("resumes at the last whole minute of what is left to watch", async () => {
    const { status, body } = await call(
      "GET",
      `/courses/${courseSlug}/contents/${video1Id}`,
    );

    expect(status).toBe(200);
    /*
     * The client reported a position of 600 — the very end — and it is stored,
     * because `lastPositionSec` is where the player was and is not evidence of
     * anything having been watched. The resume point is not taken from it: it
     * is capped at the seek ceiling first, so a learner comes back to the last
     * second the server agrees they watched (60) rather than to a position
     * their own report claimed. That cap predates P168-01 and is why the
     * refused fragment above cannot move the player either.
     */
    expect(body.lastPositionSec).toBe(600);
    expect(body.resumeAtSec).toBe(60);
    // And it is never beyond the ceiling: the position playback opens at is
    // always one the player is allowed to seek to.
    expect(body.resumeAtSec).toBeLessThanOrEqual(body.seekCeilingSec);
  });

  it("merges later intervals into the stored union across requests", async () => {
    // A learner who has been in this course a while (P55-01): the wall-clock
    // budget is measured from their last activity, and these cases report more
    // playback than the milliseconds this suite actually takes.
    await backdateProgress(VIDEO_1_SEC * 2);

    await backdateProgress(VIDEO_1_SEC * 2);

    await call("POST", `/courses/${courseSlug}/contents/${video1Id}/progress`, {
      segments: [{ startSec: 60, endSec: 540 }],
    });

    await backdateProgress(VIDEO_1_SEC * 2);

    // Continuing from the edge of the union, which is the only way forward
    // there is since P168-01 — and is what a player does.
    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      { segments: [{ startSec: 540, endSec: 600 }] },
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
    // A learner who has been in this course a while (P55-01): the wall-clock
    // budget is measured from their last activity, and these cases report more
    // playback than the milliseconds this suite actually takes.
    await backdateProgress(VIDEO_1_SEC * 2);

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
    // A learner who has been in this course a while (P55-01): the wall-clock
    // budget is measured from their last activity, and these cases report more
    // playback than the milliseconds this suite actually takes.
    await backdateProgress(VIDEO_1_SEC * 2);

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
    // A learner who has been in this course a while (P55-01): the wall-clock
    // budget is measured from their last activity, and these cases report more
    // playback than the milliseconds this suite actually takes.
    await backdateProgress(VIDEO_1_SEC * 2);

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
    // …and no other shape of answer key either (QA §3.1).
    expectNoAnswerKey(JSON.parse(serialised), "the learner's quiz");
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

/**
 * A course that awards no CME points.
 *
 * The platform is a CME platform, but not everything it will carry is
 * accredited: the client has asked for purely educational courses, and those
 * change what "complete" means. With no points there is no Punktemeldung, so
 * there is no EFN to report — and asking for one anyway would collect a
 * physician's national identifier for a purpose that does not exist, which
 * ADR-0004 exists to prevent.
 *
 * Run against the database rather than a fake because the condition rides on a
 * column copied from the course onto the enrolment at enrolment time. A select
 * that forgot the column would look exactly like a course with no points.
 */
describe("a course without CME points", () => {
  it("never lists the EFN among the outstanding conditions", async () => {
    const { status, body } = await call("PUT", `/courses/${freeCourseSlug}/enrolment`);

    expect(status).toBe(200);
    expect(body.outstanding).toEqual(["watch", "evaluation"]);
  });

  it("still does not ask for one once everything watchable is watched", async () => {
    await backdateProgress(600); // P55-01 — see the helper.
    // The interesting moment: the accredited course reaches this point with
    // "efn" outstanding and refuses to complete without it. This one has
    // nothing left but the Evaluationsbogen — no EFN is ever demanded, at any
    // stage, because there is no Punktemeldung for it to appear in.
    await call("POST", `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`, {
      segments: [{ startSec: 0, endSec: 60 }],
      lastPositionSec: 60,
    });

    const { body } = await call("GET", `/courses/${freeCourseSlug}/enrolment`);

    expect(body.achievedWatchPercent).toBe(100);
    expect(body.outstanding).toEqual(["evaluation"]);
    expect(body.efnPresent).toBe(false);
  });

  it("refuses completion for the evaluation, and says only that", async () => {
    const { status, body } = await call("POST", `/courses/${freeCourseSlug}/completion`);

    expect(status).toBe(409);
    // The problem document names what is missing. It must not mention the
    // Fortbildungsnummer, which would send a learner looking for a field that
    // this course does not have.
    expect(body.detail).not.toContain("Fortbildungsnummer");
    expect(body.detail).not.toMatch(/EFN/iu);
  });
});

/**
 * The course is finished before the paperwork is, over HTTP (P51-01).
 *
 * `completion.test.ts` decides the rule and covers it exhaustively. This
 * checks the thing that file cannot: that the API *asks* it, and that the two
 * answers travel separately all the way to the wire. A response carrying
 * `courseComplete` glued to `complete` would pass every domain test ever
 * written (CLAUDE.md §9.7).
 *
 * Runs on the free course, which by this point in the file has its one video
 * fully watched and no quiz — so `courseComplete` is already true and only the
 * Evaluationsbogen is outstanding. That is exactly the state the change exists
 * for, and before P51-01 the API called it incomplete and said nothing else.
 */
describe("course completion, reported separately from certification (P51-01)", () => {
  it("reports the course complete while the evaluation is still outstanding", async () => {
    await backdateProgress(600); // P55-01 — see the helper.
    const { status, body } = await call("GET", `/courses/${freeCourseSlug}/enrolment`);

    expect(status).toBe(200);
    expect(body.achievedWatchPercent).toBe(100);
    expect(body.courseComplete).toBe(true);
    // The point is not earned: there is still an Evaluationsbogen to fill in.
    expect(body.complete).toBe(false);
    expect(body.outstanding).toEqual(["evaluation"]);
    // And nothing holding the *course* back.
    expect(body.outstandingForCourse).toEqual([]);
  });

  it("stamps the date the course was finished, before any certification", async () => {
    await backdateProgress(600); // P55-01 — see the helper.
    const { body } = await call("GET", `/courses/${freeCourseSlug}/enrolment`);

    expect(body.courseCompletedAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(body.courseCompletedAt))).toBe(false);
    // Certification has not happened, so its own timestamp must still be null.
    expect(body.completedAt).toBeNull();
  });

  it("does not move the date once it is recorded", async () => {
    // Read twice. The stamp is written from a read path, so a missing `IS NULL`
    // in the UPDATE would turn a completion date into a last-seen date — and
    // nothing on any screen would look wrong.
    const first = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = await call("GET", `/courses/${freeCourseSlug}/enrolment`);

    expect(second.body.courseCompletedAt).toBe(first.body.courseCompletedAt);
  });

  it("still refuses to complete, because the point needs the evaluation", async () => {
    // The direction that must not have loosened. `courseComplete` is a label;
    // it must not have become a gate.
    const { status } = await call("POST", `/courses/${freeCourseSlug}/completion`);
    expect(status).toBe(409);
  });
});

/**
 * The validity window, through HTTP (P50-01).
 *
 * `availability.test.ts` covers the rule exhaustively and **every one of those
 * tests would stay green on a platform that never called it** — which is
 * CLAUDE.md §9.7, and the reason this suite exists. What is asserted here is
 * the wiring: that the catalogue query, the detail route and `enrol` each ask.
 *
 * The window is moved with SQL rather than through the console, deliberately.
 * The console is one writer; a course whose dates were set by a seed, a
 * migration or a support script has to behave identically, and driving the UI
 * would only prove the path the UI takes.
 */
describe("a course outside its validity window (P50-01)", () => {
  async function setWindow(from: string | null, to: string | null): Promise<void> {
    await seedPool.query(
      "UPDATE courses SET valid_from = $2, valid_to = $3 WHERE slug = $1",
      [freeCourseSlug, from, to],
    );
  }

  afterAll(async () => {
    // Every other case in this file assumes the course is offered.
    await setWindow(null, null);
  });

  it("is offered when it carries no window at all — the ordinary case", async () => {
    await setWindow(null, null);

    const { body } = await call("GET", "/courses?perPage=50");
    expect(body.items.map((i: { slug: string }) => i.slug)).toContain(freeCourseSlug);
  });

  it("disappears from the catalogue once the window has closed", async () => {
    await setWindow("2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z");

    const { body } = await call("GET", "/courses?perPage=50");
    expect(body.items.map((i: { slug: string }) => i.slug)).not.toContain(freeCourseSlug);
    // The total has to agree with the page, or paging shows a course the list
    // does not contain.
    expect(body.total).toBe(body.items.length);
  });

  it("answers 404 on the detail route, which a bookmark reaches directly", async () => {
    await setWindow("2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z");

    const { status } = await call("GET", `/courses/${freeCourseSlug}`);
    // 404 and not 403: a retired course must not be distinguishable from one
    // that never existed, or the status code enumerates them (§9.5).
    expect(status).toBe(404);
  });

  it("takes no new learner once the window has closed", async () => {
    await setWindow("2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z");
    await seedPool.query(
      "DELETE FROM enrolments WHERE course_id = (SELECT id FROM courses WHERE slug = $1)",
      [freeCourseSlug],
    );

    const { status } = await call("PUT", `/courses/${freeCourseSlug}/enrolment`);
    expect(status).toBe(404);
  });

  it("is hidden before the window opens, not only after it closes", async () => {
    await setWindow("2099-01-01T00:00:00Z", "2099-12-31T23:59:59Z");

    const { body } = await call("GET", "/courses?perPage=50");
    expect(body.items.map((i: { slug: string }) => i.slug)).not.toContain(freeCourseSlug);
  });

  it("keeps the enrolment of a learner who started while it was open", async () => {
    await setWindow(null, null);
    const enrolled = await call("PUT", `/courses/${freeCourseSlug}/enrolment`);
    expect(enrolled.status).toBe(200);

    await setWindow("2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z");

    const { status } = await call("PUT", `/courses/${freeCourseSlug}/enrolment`);
    expect(status).toBe(200);
  });

  /*
   * P51-02: kept, but not advanced.
   *
   * The half above and the half below are one rule and they pull in opposite
   * directions, which is why they are tested together. A physician whose course
   * has expired still has everything they did — the record, the percentages,
   * the certificate if they earned one — and can look at all of it. What they
   * cannot do is add to it.
   *
   * Each write path gets its own case rather than one loop, because each is a
   * separate call site of `requireCourseStillOffered` and the failure being
   * guarded against is somebody adding a fifth path and not calling it
   * (CLAUDE.md §9.3). A loop over a list would grow only when the list did.
   */
  describe("and a learner already on it (P51-02)", () => {
    beforeEach(async () => {
      await setWindow(null, null);
      await call("PUT", `/courses/${freeCourseSlug}/enrolment`);
      await setWindow("2020-01-01T00:00:00Z", "2020-12-31T23:59:59Z");
    });

    it("still lets them read their own state", async () => {
      // The whole point of "keep the existing". If this is ever a 404 the
      // learner's history has been taken away, not frozen.
      const { status } = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
      expect(status).toBe(200);
    });

    it("refuses further playback", async () => {
      const { status } = await call(
        "POST",
        `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`,
        { segments: [{ startSec: 0, endSec: 10 }], lastPositionSec: 10 },
      );

      // 409, not 404: they are enrolled and looking at it. The world changed,
      // their permissions did not.
      expect(status).toBe(409);
    });

    it("tells them their results are kept, because that is the first fear", async () => {
      const { body } = await call(
        "POST",
        `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`,
        { segments: [{ startSec: 0, endSec: 10 }], lastPositionSec: 10 },
      );

      expect(body.detail).toMatch(/abgelaufen/u);
      expect(body.detail).toMatch(/bleiben erhalten/u);
    });

    it("writes nothing when it refuses the playback", async () => {
      /*
       * The stored progress is cleared first, and that is not tidiness — it is
       * what makes this test capable of failing. Written the obvious way, it
       * read the watch percentage before and after against a video that was
       * already 100 % watched by an earlier case, so both readings were 100
       * whether or not the refused write had landed. It passed on a build with
       * the check disabled (CLAUDE.md §9.1).
       */
      await seedPool.query(
        `DELETE FROM content_progress
          WHERE enrolment_id IN (
            SELECT id FROM enrolments
             WHERE course_id = (SELECT id FROM courses WHERE slug = $1))`,
        [freeCourseSlug],
      );

      const before = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
      expect(before.body.achievedWatchPercent).toBe(0);

      await call("POST", `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`, {
        segments: [{ startSec: 0, endSec: 60 }],
        lastPositionSec: 60,
      });

      const after = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
      expect(after.body.achievedWatchPercent).toBe(0);
    });

    it("says 'not yet' rather than 'expired' when the window has not opened", async () => {
      // Reachable by moving `valid_from` forward on a course people are already
      // taking. Narrow, but "Ihr Teilnahmezeitraum ist abgelaufen" would send a
      // physician looking for a deadline they never missed — and the domain
      // already distinguishes the two states.
      await setWindow("2099-01-01T00:00:00Z", "2099-12-31T23:59:59Z");

      const { status, body } = await call(
        "POST",
        `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`,
        { segments: [{ startSec: 0, endSec: 10 }], lastPositionSec: 10 },
      );

      expect(status).toBe(409);
      expect(body.detail).toMatch(/noch nicht freigeschaltet/u);
      expect(body.detail).not.toMatch(/abgelaufen/u);
    });

    it("refuses the evaluation", async () => {
      const { status } = await call("POST", `/courses/${freeCourseSlug}/evaluation`, {
        answers: [],
      });
      expect(status).toBe(409);
    });

    it("refuses completion, for the window rather than the missing conditions", async () => {
      /*
       * The status alone proves nothing here: completion on this course is a
       * 409 anyway while the Evaluationsbogen is outstanding, so a version of
       * this test asserting only `409` stayed green with the window check
       * removed. What separates the two refusals is the words, and the words
       * are what the learner acts on — being sent to fill in a form that the
       * next request refuses for an unmentioned reason is the failure.
       */
      const { status, body } = await call(
        "POST",
        `/courses/${freeCourseSlug}/completion`,
      );

      expect(status).toBe(409);
      expect(body.detail).toMatch(/abgelaufen/u);
      expect(body.detail).not.toMatch(/Evaluation/u);
    });
  });
});

/**
 * Editorial state, through HTTP (P53-01).
 *
 * Found by QA doing the obvious thing: `POST /admin/courses` as a super
 * administrator, then `GET /courses` as a learner. The empty course was there
 * — listed, openable and enrollable — because nothing had ever asked whether a
 * course was finished being written. The console was authoring in front of the
 * physicians.
 *
 * The window suite above is the same shape and is deliberately not extended to
 * cover this: `valid_from`/`valid_to` say *when an accredited course runs*, and
 * `status` says *whether anybody may see it yet*. They are separately settable
 * and a course can be wrong on either axis, so each gets its own cases.
 *
 * The status is moved with SQL for the same reason the window was: the console
 * is one writer of it, and a course whose status came from a seed or a support
 * script has to behave identically.
 */
/*
 * P167-01. A section of prose is part of the Fortbildung.
 *
 * `docs/show-stoppers.md` §S33, answered by the client: a checkbox saying the
 * text has been read, which enables the button onward and counts that part as
 * done. Before it, `POST /progress` accepted videos only and
 * `isCourseComplete` never asked — so a course of nothing but text completed on
 * enrolment, and a mixed course completed with its prose never opened.
 *
 * Its own course, so nothing here can be satisfied by the shared fixture's
 * videos, and the completion is genuinely decided by the acknowledgement.
 */
describe("a text section a learner has to say they have read", () => {
  let slug = "";
  let textId = "";
  let otherTextId = "";

  beforeAll(async () => {
    slug = `text-course-${suffixForTests}`;
    const courseId = await insert(
      `INSERT INTO courses (customer_id, project_id, slug, title, delivery_type, status,
                            required_watch_percent, pass_threshold_percent)
       VALUES ($1,$2,$3,$4,'on_demand','published',100,70) RETURNING id`,
      [customerId, projectId, slug, "Nur Text"],
    );
    const moduleId = await insert(
      "INSERT INTO modules (customer_id, course_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
      [customerId, courseId, "Modul 1"],
    );
    const chapterId = await insert(
      "INSERT INTO chapters (customer_id, module_id, ordinal, title) VALUES ($1,$2,0,$3) RETURNING id",
      [customerId, moduleId, "Kapitel 1"],
    );
    textId = await insert(
      `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, body)
       VALUES ($1,$2,0,'text',$3,$4) RETURNING id`,
      [customerId, chapterId, "Grundlagen als Text", "Ein Absatz."],
    );
    otherTextId = await insert(
      `INSERT INTO contents (customer_id, chapter_id, ordinal, kind, title, body)
       VALUES ($1,$2,1,'text',$3,$4) RETURNING id`,
      [customerId, chapterId, "Vertiefung", "Noch ein Absatz."],
    );

    expect((await call("PUT", `/courses/${slug}/enrolment`)).status).toBe(200);
  });

  it("does not complete a course of nothing but text on enrolment", () =>
    call("GET", `/courses/${slug}/enrolment`).then(({ body }) => {
      expect(body.courseComplete).toBe(false);
      expect(body.outstanding).toContain("reading");
    }));

  it("refuses the completion while a section is unread, naming it", async () => {
    const { status, body } = await call("POST", `/courses/${slug}/completion`);

    expect(status).toBe(409);
    expect(body.detail).toBeTypeOf("string");
  });

  it("records the acknowledgement, and is not satisfied by only one of two", async () => {
    const first = await call(
      "POST",
      `/courses/${slug}/contents/${textId}/acknowledgement`,
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toEqual({ contentId: textId, status: "completed" });

    const { body } = await call("GET", `/courses/${slug}/enrolment`);
    expect(body.courseComplete).toBe(false);
    expect(body.outstanding).toContain("reading");
  });

  it("completes the course once every section is acknowledged", async () => {
    expect(
      (await call("POST", `/courses/${slug}/contents/${otherTextId}/acknowledgement`))
        .status,
    ).toBe(200);

    const { body } = await call("GET", `/courses/${slug}/enrolment`);
    expect(body.courseComplete).toBe(true);
    expect(body.outstanding).not.toContain("reading");
  });

  it("is idempotent, because a double-clicked checkbox is not a new fact", async () => {
    const again = await call(
      "POST",
      `/courses/${slug}/contents/${textId}/acknowledgement`,
    );
    expect(again.status).toBe(200);

    const { body } = await call("GET", `/courses/${slug}/enrolment`);
    expect(body.courseComplete).toBe(true);
  });

  it("refuses to accept an attestation for a video", async () => {
    /*
     * The guard that keeps this from becoming a way past the watch gate. A
     * video has a completion event of its own and it is measured, not stated.
     */
    const { status } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/acknowledgement`,
    );

    expect(status).toBe(422);
  });
});

describe("a course that is still a draft (P53-01)", () => {
  async function setStatus(status: "draft" | "published"): Promise<void> {
    await seedPool.query("UPDATE courses SET status = $2 WHERE slug = $1", [
      freeCourseSlug,
      status,
    ]);
  }

  afterAll(async () => {
    await setStatus("published");
  });

  it("is listed while published — the reading that makes the rest evidence", async () => {
    // Without this case every assertion below passes on a catalogue that is
    // simply empty, which is the failure mode CLAUDE.md §9.1 is about.
    await setStatus("published");

    const { body } = await call("GET", "/courses?perPage=50");
    expect(body.items.map((i: { slug: string }) => i.slug)).toContain(freeCourseSlug);
  });

  it("disappears from the catalogue the moment it is retracted", async () => {
    await setStatus("draft");

    const { body } = await call("GET", "/courses?perPage=50");
    expect(body.items.map((i: { slug: string }) => i.slug)).not.toContain(freeCourseSlug);
    // The total has to agree with the page, or paging offers a course the list
    // does not contain.
    expect(body.total).toBe(body.items.length);
  });

  it("answers 404 on the detail route, which a shared link reaches directly", async () => {
    await setStatus("draft");

    const { status } = await call("GET", `/courses/${freeCourseSlug}`);
    // 404 and not 403: an unpublished course must not be distinguishable from
    // one that does not exist, or the status code enumerates what a customer
    // is working on (§9.5).
    expect(status).toBe(404);
  });

  it("takes no new learner", async () => {
    await setStatus("draft");
    await seedPool.query(
      "DELETE FROM enrolments WHERE course_id = (SELECT id FROM courses WHERE slug = $1)",
      [freeCourseSlug],
    );

    const { status } = await call("PUT", `/courses/${freeCourseSlug}/enrolment`);
    expect(status).toBe(404);
  });

  it("appears again when it is published, without a restart or a cache flush", async () => {
    // The transition is the product feature — "publish" is a button an operator
    // presses and then looks at the site. A test that only ever retracted would
    // pass on an implementation that could never publish anything.
    await setStatus("draft");
    const hidden = await call("GET", "/courses?perPage=50");
    expect(hidden.body.items.map((i: { slug: string }) => i.slug)).not.toContain(
      freeCourseSlug,
    );

    await setStatus("published");

    const shown = await call("GET", "/courses?perPage=50");
    expect(shown.body.items.map((i: { slug: string }) => i.slug)).toContain(
      freeCourseSlug,
    );
    expect((await call("GET", `/courses/${freeCourseSlug}`)).status).toBe(200);
    expect((await call("PUT", `/courses/${freeCourseSlug}/enrolment`)).status).toBe(200);
  });

  /*
   * Retraction, for somebody already on it. Same rule as the expired window and
   * the same reason it is tested separately: an operator who pulls a course
   * back to fix a chapter must not delete the record of a physician who is
   * half-way through it — and must not let them carry on accumulating watch
   * time against material that is being rewritten underneath them.
   */
  describe("and a learner who enrolled before it was retracted", () => {
    beforeEach(async () => {
      await setStatus("published");
      await call("PUT", `/courses/${freeCourseSlug}/enrolment`);
      await setStatus("draft");
    });

    it("still lets them read their own state", async () => {
      const { status } = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
      expect(status).toBe(200);
    });

    it("refuses further playback", async () => {
      const { status } = await call(
        "POST",
        `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`,
        { segments: [{ startSec: 0, endSec: 10 }], lastPositionSec: 10 },
      );
      expect(status).toBe(409);
    });

    it("does not tell them their Teilnahmezeitraum expired, because it did not", async () => {
      /*
       * The status alone proves nothing — an expired course answers 409 here
       * too, so this case stayed green with `"draft"` mapped to the expiry
       * message. The words are the whole difference: a physician told their
       * participation window has run out goes looking for a deadline they
       * never missed, and there is nothing they can do about it. "Derzeit
       * nicht verfügbar" is the truthful one, and it is temporary.
       */
      const { body } = await call(
        "POST",
        `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`,
        { segments: [{ startSec: 0, endSec: 10 }], lastPositionSec: 10 },
      );

      expect(body.detail).toMatch(/derzeit nicht verfügbar/iu);
      expect(body.detail).toMatch(/bleiben erhalten/u);
      expect(body.detail).not.toMatch(/abgelaufen/u);
    });

    it("writes nothing when it refuses the playback", async () => {
      await seedPool.query(
        `DELETE FROM content_progress
          WHERE enrolment_id IN (
            SELECT id FROM enrolments
             WHERE course_id = (SELECT id FROM courses WHERE slug = $1))`,
        [freeCourseSlug],
      );

      const before = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
      expect(before.body.achievedWatchPercent).toBe(0);

      await call("POST", `/courses/${freeCourseSlug}/contents/${freeVideoId}/progress`, {
        segments: [{ startSec: 0, endSec: 60 }],
        lastPositionSec: 60,
      });

      const after = await call("GET", `/courses/${freeCourseSlug}/enrolment`);
      expect(after.body.achievedWatchPercent).toBe(0);
    });

    it("refuses the evaluation", async () => {
      const { status } = await call("POST", `/courses/${freeCourseSlug}/evaluation`, {
        answers: [],
      });
      expect(status).toBe(409);
    });

    it("refuses completion, for the retraction rather than the missing conditions", async () => {
      const { status, body } = await call(
        "POST",
        `/courses/${freeCourseSlug}/completion`,
      );

      expect(status).toBe(409);
      expect(body.detail).toMatch(/derzeit nicht verfügbar/iu);
      expect(body.detail).not.toMatch(/Evaluation/u);
    });
  });
});

/**
 * The wall-clock floor on a first report, through HTTP (P55-01).
 *
 * `learning.service.test.ts` covers the rule against a fake repository. This
 * covers the thing that suite cannot: that the budget is computed from rows
 * the *database* holds — `enrolments.created_at` and the newest
 * `content_progress.updated_at` — rather than from anything the request
 * carries. The hole it closes was reachable with two HTTP calls and nothing
 * else: enrol, then claim the whole video.
 *
 * **Last in the file, deliberately.** Every case here clears this enrolment's
 * progress and moves its `created_at`, and the journey above it is cumulative
 * — a block that reset the learner's history halfway through would fail eight
 * later cases for reasons having nothing to do with them (CLAUDE.md §9.8, the
 * ambient-state lesson, one layer out).
 */
describe("a whole video claimed on a fresh enrolment (P55-01)", () => {
  beforeEach(async () => {
    // A learner who has just this second enrolled and touched nothing.
    await seedPool.query(
      `DELETE FROM content_progress
        WHERE enrolment_id IN (
          SELECT id FROM enrolments
           WHERE course_id = (SELECT id FROM courses WHERE slug = $1))`,
      [courseSlug],
    );
    await call("PUT", `/courses/${courseSlug}/enrolment`);
    await seedPool.query(
      `UPDATE enrolments SET created_at = now()
        WHERE course_id = (SELECT id FROM courses WHERE slug = $1)`,
      [courseSlug],
    );
  });

  it("refuses it, and credits nothing", async () => {
    const { status, body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      { segments: [{ startSec: 0, endSec: VIDEO_1_SEC }], lastPositionSec: VIDEO_1_SEC },
    );

    // 200 with a rejection, not 4xx: the report was well-formed and the server
    // is telling the player what it credited. A player that had genuinely
    // buffered ahead simply reports again once the time has passed.
    expect(status).toBe(200);
    expect(body.rejected[0]?.reason).toBe("faster_than_wallclock");
    expect(body.watchedPercent).toBe(0);
  });

  it("stores nothing either — the refusal is not only in the response", async () => {
    await call("POST", `/courses/${courseSlug}/contents/${video1Id}/progress`, {
      segments: [{ startSec: 0, endSec: VIDEO_1_SEC }],
      lastPositionSec: VIDEO_1_SEC,
    });

    const { body } = await call("GET", `/courses/${courseSlug}/enrolment`);
    expect(body.achievedWatchPercent).toBe(0);
  });

  it("accepts what the elapsed time does cover", async () => {
    /*
     * The other half, and the reason this is a floor rather than a ban. Twenty
     * minutes after enrolling, ten minutes of video is entirely possible — and
     * a rule that refused it would break every player that reports at the end
     * of a chapter instead of during it.
     */
    await seedPool.query(
      `UPDATE enrolments SET created_at = now() - interval '20 minutes'
        WHERE course_id = (SELECT id FROM courses WHERE slug = $1)`,
      [courseSlug],
    );

    const { body } = await call(
      "POST",
      `/courses/${courseSlug}/contents/${video1Id}/progress`,
      { segments: [{ startSec: 0, endSec: VIDEO_1_SEC }], lastPositionSec: VIDEO_1_SEC },
    );

    expect(body.rejected).toEqual([]);
    expect(body.watchedPercent).toBe(100);
  });
});

/**
 * What a refusal from the PDF route is labelled as (P56-02).
 *
 * `GET /courses/{slug}/certificate/pdf` declares `content-type:
 * application/pdf`, and a `@Header` decorator is applied *before* the handler
 * runs — so every refusal from it went out as a problem document wearing a
 * PDF's content type. A browser offers to save a broken file; a client that
 * dispatches on the header hands a few hundred bytes of JSON to a renderer.
 *
 * This learner has watched everything and never certified anything, which is
 * exactly how somebody reaches it in practice: opening the certificate link
 * before the Zertifizierung is finished.
 */
describe("a refusal from a route that promises a PDF (P56-02)", () => {
  it("is labelled as a problem document, not as a PDF", async () => {
    const response = await fetch(`${baseUrl}/courses/${courseSlug}/certificate/pdf`, {
      headers: { authorization: `Bearer ${await token()}`, "x-ds-project": projectSlug },
    });

    expect(response.status).not.toBe(200);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(response.headers.get("content-type")).not.toContain("application/pdf");
  });

  it("really is a problem document, not just a header saying so", async () => {
    // Half a fix is a header that lies in the other direction.
    const response = await fetch(`${baseUrl}/courses/${courseSlug}/certificate/pdf`, {
      headers: { authorization: `Bearer ${await token()}`, "x-ds-project": projectSlug },
    });

    const body = (await response.json()) as { status: number; instance: string };
    expect(body.status).toBe(response.status);
    expect(body.instance).toContain(courseSlug);
  });
});
