/**
 * A GDPR erasure is answered within one deadline, whatever the bucket does
 * (P249-02, closes RUN-2).
 *
 * ## The failure this pins
 *
 * `DELETE /admin/learners/:enrolmentId` erases the subject in Postgres and then
 * deletes the archived certificates that SQL cannot reach. That second half
 * used to run inside the request's ambient RLS transaction and work through up
 * to fifty queued objects one by one, each with a 15-second deadline. With the
 * bucket unreachable, ten objects are 150 seconds — past
 * `idle_in_transaction_session_timeout` (120 s), so Postgres killed the
 * request's session and the operator was shown a 500 for an erasure that had
 * already been committed on the side pool.
 *
 * The bucket here is a **blackhole**: it accepts the TCP connection and never
 * answers, which is the shape that costs the full per-call deadline every
 * time. A refusing bucket would answer fast and prove nothing.
 *
 * ## What "recorded" means
 *
 * `erase_subject`'s own audit row, and every queued object still outstanding
 * (`deleted_at IS NULL`) — the obligation survives for the boot drain and the
 * next erasure rather than being discharged by a deadline.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { hash } from "@node-rs/argon2";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { REQUEST_DRAIN_DEADLINE_MS } from "../../src/modules/certificate/object-erasure.service.js";
import { requireEnv } from "./support/env.js";
import { seedLearner } from "./support/seed-learner.js";
import { signInStaff, type StaffSession } from "./support/staff-session.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const RUN = randomUUID().slice(0, 8);
const PASSWORD = "erasure-deadline-suite-password";

/** The request-path drain's overall budget — the product's own, not a test value. */
const DEADLINE_MS = REQUEST_DRAIN_DEADLINE_MS;
/** What the client allows on top of it before calling the answer late. */
const SLACK_MS = 5_000;
const QUEUED_OBJECTS = 10;

let pool: Pool;
let app: NestExpressApplication;
let baseUrl: string;
let session: StaffSession;
let customerId: string;
let enrolmentId: string;
let userId: string;

let blackhole: Server;
const held: Socket[] = [];

beforeAll(async () => {
  pool = createPool({ connectionString: SUPERUSER_URL });

  // Accepts, reads, never answers.
  blackhole = createServer((socket) => {
    held.push(socket);
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => blackhole.listen(0, "127.0.0.1", resolve));
  const address = blackhole.address();
  if (address === null || typeof address === "string") throw new Error("no port");

  process.env["S3_ENDPOINT"] = `http://127.0.0.1:${address.port}`;
  process.env["S3_REGION"] = "eu-central-1";
  process.env["S3_BUCKET"] = "erasure-deadline";
  process.env["S3_ACCESS_KEY_ID"] = "test";
  process.env["S3_SECRET_ACCESS_KEY"] = "test-secret";
  process.env["S3_FORCE_PATH_STYLE"] = "yes";
  // No boot drain or delivery sweep competing for the queue under test.
  process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`erasure-${RUN}`, "Erasure GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, `abt-${RUN}`, "Abteilung"],
  );
  const issuer = `http://127.0.0.1:1/realms/erasure-${RUN}`;
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,'unused') RETURNING id`,
    [customerId, departmentId, `projekt-${RUN}`, "Projekt", issuer],
  );
  const courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,90,70,'draft') RETURNING id`,
    [customerId, projectId, `kurs-${RUN}`, "Kurs"],
  );
  ({ id: userId } = await seedLearner(pool, {
    realm: issuer,
    subject: `subject-${RUN}`,
  }));
  enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent)
     VALUES ($1,$2,$3,90,70) RETURNING id`,
    [customerId, courseId, userId],
  );

  const email = `erasure-${RUN}@guards.test`;
  const adminId = await insert(
    "INSERT INTO admin_users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id",
    [email, "Erasure Admin", await hash(PASSWORD, { algorithm: 2 })],
  );
  await pool.query(
    "INSERT INTO admin_user_roles (admin_user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [adminId, customerId],
  );

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);
  const bound = app.getHttpServer().address();
  if (bound === null || typeof bound === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${bound.port}`;

  session = await signInStaff({ baseUrl, email, password: PASSWORD });
}, 60_000);

afterAll(async () => {
  for (const socket of held) socket.destroy();
  await app?.close();
  await new Promise<void>((resolve) => blackhole.close(() => resolve()));
  await pool?.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

describe("erasing a subject while the bucket never answers", () => {
  it(
    "answers 2xx within the deadline and records the erasure",
    async () => {
      for (let index = 0; index < QUEUED_OBJECTS; index += 1) {
        await pool.query(
          "INSERT INTO object_erasures (customer_id, object_key, reason) VALUES ($1,$2,'test')",
          [customerId, `certificates/${RUN}/${String(index)}.pdf`],
        );
      }

      const started = Date.now();
      const response = await fetch(`${baseUrl}/admin/learners/${enrolmentId}`, {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
          "x-ds-csrf": session.csrf,
          "x-ds-customer": customerId,
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Löschantrag" }),
        signal: AbortSignal.timeout(DEADLINE_MS + SLACK_MS),
      });
      const elapsed = Date.now() - started;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(DEADLINE_MS + SLACK_MS);

      // The erasure happened and audited itself.
      const audit = await pool.query(
        "SELECT 1 FROM audit_log WHERE action = 'learner.erasure_requested' AND subject = $1",
        [userId],
      );
      expect(audit.rows).toHaveLength(1);

      // Every object is still owed: a deadline is not a discharge.
      const owed = await pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM object_erasures WHERE customer_id = $1 AND deleted_at IS NULL",
        [customerId],
      );
      expect(Number(owed.rows[0]?.n)).toBe(QUEUED_OBJECTS);

      // And the request path did not claim what it had no time to attempt:
      // at most the objects tried inside the deadline carry an attempt.
      const attempted = await pool.query<{ n: string }>(
        "SELECT count(*) AS n FROM object_erasures WHERE customer_id = $1 AND attempts > 0",
        [customerId],
      );
      expect(Number(attempted.rows[0]?.n)).toBeLessThan(QUEUED_OBJECTS);
    },
    DEADLINE_MS + SLACK_MS + 10_000,
  );
});
