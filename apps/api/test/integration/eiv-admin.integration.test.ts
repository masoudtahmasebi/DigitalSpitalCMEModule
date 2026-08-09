/**
 * Operator-facing EIV operations, against a real Postgres and the real mock
 * (P31-02). **Human review gate — auth, eiv.**
 *
 * These are the operations that reach out of this platform and change, or fail
 * to change, a record at an Ärztekammer. The unit tests can prove the decisions;
 * only this can prove that the tenant-scoped repository sees the right rows,
 * that the enum value `withdrawn` exists in the database, and that the round
 * trip to the authority and back leaves our record agreeing with theirs.
 *
 * The three things worth breaking a build over, in order:
 *
 * 1. A withdrawal outside the correction window is refused, because EIV would
 *    refuse it and a UI that pretended otherwise would send an operator away
 *    believing a physician's points were gone.
 * 2. A reconciliation reports a disagreement in **both** directions, because
 *    only one of them is a failure of ours and they need different responses.
 * 3. Neither an EFN nor a VNR password appears in anything these produce.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  EivAccreditationReporter,
  startMockServer,
  type MockServer,
} from "@ds/eiv-client";
import { AuditService } from "../../src/audit/audit.service.js";
import { PlaintextSecretCipher } from "../../src/shared/secret-cipher.js";
import { EivAdminRepository } from "../../src/modules/eiv/eiv-admin.repository.js";
import { EivAdminService } from "../../src/modules/eiv/eiv-admin.service.js";
import { runInTenant } from "../../src/db/tenant-db.js";
import { seedLearner } from "./support/seed-learner.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} must be set to run the integration suite.`);
  }
  return value;
}

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const DATABASE_URL = requireEnv("DATABASE_URL");

const EFN = "802760699999990";
const VNR = "8888888888888888888";
const VNR_PASSWORD = "mock-vnr-password";
const cipher = new PlaintextSecretCipher("test");

/** The accredited period the mock enforces, exactly as EIV does. */
const BEGINN = "2020-01-01";
const ENDE = "2099-12-31";

let seedPool: Pool;
let appPool: Pool;
let mock: MockServer;

let customerId: string;
let courseId: string;
let courseSlug: string;

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });
  appPool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  mock = await startMockServer(0, { eventBeginn: BEGINN, eventEnde: ENDE });

  const suffix = randomUUID().slice(0, 8);
  courseSlug = `eiv-admin-course-${suffix}`;

  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`eiv-admin-${suffix}`, "EIV Admin GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [customerId, departmentId, `eiv-admin-project-${suffix}`, "EIV admin project"],
  );
  courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, vnr, vnr_password_enc)
     VALUES ($1,$2,$3,$4,100,70,$5,$6) RETURNING id`,
    [
      customerId,
      projectId,
      courseSlug,
      "EIV admin course",
      VNR,
      cipher.encrypt(VNR_PASSWORD),
    ],
  );
}, 30_000);

afterAll(async () => {
  await mock?.close();
  await seedPool.end();
  await appPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

/**
 * One completed enrolment with a submission in whatever state the test wants.
 *
 * A fresh learner each time, because enrolments are unique on
 * `(course_id, user_id)`.
 */
async function seedSubmission(input: {
  status: string;
  efn?: string;
  eventEndAt?: Date;
  firstSubmittedAt?: Date | null;
}): Promise<{ enrolmentId: string; submissionId: string }> {
  const suffix = randomUUID().slice(0, 8);
  const eventEndAt = input.eventEndAt ?? new Date();
  const userId = (
    await seedLearner(seedPool, {
      realm: `http://127.0.0.1/realms/eiv-admin-${suffix}`,
      subject: `eiv-admin-sub-${suffix}`,
    })
  ).id;

  const enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, completed_at)
     VALUES ($1,$2,$3,100,70,$4) RETURNING id`,
    [customerId, courseId, userId, eventEndAt],
  );

  const submissionId = await insert(
    `INSERT INTO eiv_submissions (customer_id, enrolment_id, vnr, efn, event_end_at,
                                  report_due_at, first_submitted_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      customerId,
      enrolmentId,
      VNR,
      input.efn ?? EFN,
      eventEndAt,
      new Date(eventEndAt.getTime() + 8 * 86_400_000),
      input.firstSubmittedAt === undefined ? eventEndAt : input.firstSubmittedAt,
      input.status,
    ],
  );

  return { enrolmentId, submissionId };
}

const ACTOR = { customerId: "", staffUserId: randomUUID() };

/** The service, inside the tenant scope a request would have opened. */
async function withService<T>(run: (service: EivAdminService) => Promise<T>): Promise<T> {
  return runInTenant(
    appPool,
    // The role a request would carry: these endpoints are customer_admin and
    // above, and RLS reads the same session variable either way.
    { customerId, role: "customer_admin" },
    async (db) =>
      run(
        new EivAdminService(
          new EivAdminRepository(db, cipher),
          new EivAccreditationReporter(),
          new AuditService(seedPool),
          { baseUrl: mock.url },
        ),
      ),
  );
}

function actor() {
  return { ...ACTOR, customerId };
}

async function statusOf(submissionId: string): Promise<string> {
  const { rows } = await seedPool.query<{ status: string }>(
    "SELECT status FROM eiv_submissions WHERE id = $1",
    [submissionId],
  );
  return rows[0]?.status ?? "";
}

describe("asking the authority about the event (P31-02)", () => {
  it("reads the accredited period and the point values", async () => {
    // The whole reason this endpoint exists: the period is what a
    // teilnahmedatum is checked against, and it is knowable before any
    // physician completes rather than after one has been promised a point.
    const event = await withService((service) => service.describeEvent(courseSlug));

    expect(event.validFrom).toContain(BEGINN);
    expect(event.validUntil).toContain(ENDE);
    expect(event.attendancePoints).toBe(4);
    expect(event.locked).toBe(false);
  });

  it("refuses a course with no VNR rather than asking about nothing", async () => {
    const suffix = randomUUID().slice(0, 8);
    const slug = `eiv-admin-novnr-${suffix}`;
    await seedPool.query(
      `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                            pass_threshold_percent)
       SELECT customer_id, project_id, $2, 'No VNR', 100, 70 FROM courses WHERE id = $1`,
      [courseId, slug],
    );

    await expect(withService((s) => s.describeEvent(slug))).rejects.toMatchObject({
      kind: "conflict",
    });
  });
});

describe("requeueing an abandoned Punktemeldung (P31-02)", () => {
  it("returns the row to the queue and clears the permanent failure", async () => {
    /*
     * `last_error` matters as much as the status. A `business` failure is
     * permanent, so leaving it would make `planEivAttempt` abandon the row
     * again on the worker's very next pass — the operator would press the
     * button, see it succeed, and nothing would happen.
     */
    const { enrolmentId, submissionId } = await seedSubmission({
      status: "failed_permanent",
    });
    await seedPool.query(
      "UPDATE eiv_submissions SET last_error = 'business', attempt_count = 4 WHERE id = $1",
      [submissionId],
    );

    await withService((s) => s.requeue(enrolmentId, actor(), new Date()));

    const { rows } = await seedPool.query<{
      status: string;
      last_error: string | null;
      attempt_count: number;
    }>("SELECT status, last_error, attempt_count FROM eiv_submissions WHERE id = $1", [
      submissionId,
    ]);

    expect(rows[0]?.status).toBe("queued");
    expect(rows[0]?.last_error).toBeNull();
    expect(rows[0]?.attempt_count).toBe(0);
  });

  it("refuses once the reporting window has closed", async () => {
    // Nothing electronic is possible after it. Offering the button anyway
    // would let an operator believe the problem had been dealt with.
    const old = new Date(Date.now() - 60 * 86_400_000);
    const { enrolmentId } = await seedSubmission({
      status: "failed_permanent",
      eventEndAt: old,
      firstSubmittedAt: null,
    });

    await expect(
      withService((s) => s.requeue(enrolmentId, actor(), new Date())),
    ).rejects.toMatchObject({ kind: "conflict" });
  });
});

describe("withdrawing a reported Punktemeldung (P31-02)", () => {
  it("zeroes the points at the authority and records it here", async () => {
    const { enrolmentId, submissionId } = await seedSubmission({
      status: "submitted",
      efn: "802760699999991",
    });

    await withService((s) =>
      s.withdraw(enrolmentId, "Widerruf auf Wunsch, Ticket 4711", actor(), new Date()),
    );

    // Ours.
    expect(await statusOf(submissionId)).toBe("withdrawn");

    // Theirs: the record survives with the points zeroed. Not a deletion —
    // "der Vorgang bleibt nachvollziehbar".
    const held = mock.submissions.find((row) => row.efn === "802760699999991");
    expect(held).toBeDefined();
    expect(held?.punkteBasisFlag).toBe(0);
    expect(held?.punkteLernerfolgFlag).toBe(0);
  });

  it("refuses when nothing was ever reported", async () => {
    const { enrolmentId } = await seedSubmission({ status: "queued" });

    await expect(
      withService((s) => s.withdraw(enrolmentId, "reason", actor(), new Date())),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("refuses after the seven-day correction window", async () => {
    // EIV will not accept it, and the remedy is the written one in §2 of the
    // Anerkennungsbescheid. Saying so beats a 502 the operator has to decode.
    const old = new Date(Date.now() - 30 * 86_400_000);
    const { enrolmentId } = await seedSubmission({
      status: "submitted",
      eventEndAt: old,
      firstSubmittedAt: old,
    });

    await expect(
      withService((s) => s.withdraw(enrolmentId, "reason", actor(), new Date())),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("writes an audit entry naming the operator and carrying no EFN", async () => {
    const { enrolmentId } = await seedSubmission({
      status: "submitted",
      efn: "802760699999992",
    });

    await withService((s) =>
      s.withdraw(enrolmentId, "Widerruf, Ticket 4712", actor(), new Date()),
    );

    const { rows } = await seedPool.query<{ detail: unknown; actor_id: string }>(
      `SELECT detail, actor_id FROM audit_log
        WHERE customer_id = $1 AND action = 'eiv.withdrawn' AND subject = $2`,
      [customerId, enrolmentId],
    );

    expect(rows).toHaveLength(1);
    const serialised = JSON.stringify(rows[0]);
    expect(serialised).toContain("Ticket 4712");
    expect(serialised).not.toContain("802760699999992");
    expect(serialised).not.toContain(VNR_PASSWORD);
  });
});

describe("reconciling with the authority (P31-02)", () => {
  it("reports both directions of disagreement, and masks the EFN", async () => {
    /*
     * Both directions, because they are not the same problem:
     *
     * - only here — we think it was reported and the Kammer does not hold it.
     *   The physician believes they have points that were never credited.
     * - only there — the Kammer holds one we have no accepted record of. The
     *   points exist; our own log is what is wrong.
     */
    const onlyHere = "802760699999993";
    const onlyThere = "802760699999994";

    await seedSubmission({ status: "submitted", efn: onlyHere });

    // Put one at the authority that this platform never recorded as accepted.
    const reporter = new EivAccreditationReporter();
    await reporter.report({
      efn: onlyThere,
      vnr: VNR,
      completedAt: new Date(),
      endpoint: mock.url,
      credentials: { vnrPassword: VNR_PASSWORD },
    });

    const result = await withService((s) => s.reconcile(courseSlug));

    const here = result.rows.find((row) => row.efnMasked.endsWith("9993"));
    const there = result.rows.find((row) => row.efnMasked.endsWith("9994"));

    expect(here?.here).toBe(true);
    expect(here?.there).toBe(false);
    expect(there?.here).toBe(false);
    expect(there?.there).toBe(true);

    expect(result.onlyHere).toBeGreaterThanOrEqual(1);
    expect(result.onlyThere).toBeGreaterThanOrEqual(1);

    // ADR-0004: the whole EFN never leaves the service.
    expect(JSON.stringify(result.rows)).not.toContain(onlyHere);
  });
});
