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
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
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
import { requireEnv } from "./support/env.js";

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
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  appPool = createPool({ connectionString: DATABASE_URL, max: 5 });
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
                          pass_threshold_percent, vnr, vnr_password_enc, status)
     VALUES ($1,$2,$3,$4,100,70,$5,$6,'published') RETURNING id`,
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
}): Promise<{ enrolmentId: string; submissionId: string; userId: string }> {
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

  return { enrolmentId, submissionId, userId };
}

const ACTOR = { customerId: "", staffUserId: randomUUID() };

/** The service, inside the tenant scope a request would have opened. */
async function withService<T>(
  run: (service: EivAdminService) => Promise<T>,
  /**
   * A different register for one case (P184-01). The accredited period is the
   * register's answer, so testing "the queue falls outside it" needs a second
   * mock describing a different event rather than a different queue.
   */
  over: { baseUrl?: string } = {},
): Promise<T> {
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
          // Armed, so the report's `submissionsEnabled` has a value that is
          // not the type's default — a fixture pinned to `false` could not tell
          // "reports the flag" from "reports nothing".
          { baseUrl: over.baseUrl ?? mock.url, submissionsEnabled: true },
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

describe("the connection check says which installation this is (P107-01)", () => {
  /*
   * The client set the live endpoint, read the console, and reported
   * *"i updated this, still shows with test in verwaltung"* — the deploy had
   * not run, and nothing on the screen distinguished
   * `backend-test.eiv-fobi.de` from `backend.eiv-fobi.de` anyway.
   *
   * Tested here rather than only in the console, because the console renders
   * whatever it is handed: the property that matters is that the API derives
   * the tier from the endpoint it is *actually configured with*, and reports
   * the worker's real flag rather than a constant. `eivEndpointTier` itself is
   * exhaustively unit-tested in `@ds/eiv-client`; this names its caller (§9.7).
   */
  it("derives the tier from the endpoint the API is running against", async () => {
    // The fixture points at the local mock, so this is the honest answer for
    // this installation — and it is the one that must never read `live`.
    const report = await withService((service) =>
      service.checkConnection(courseSlug, undefined, actor()),
    );

    expect(report.endpoint).toBe(mock.url);
    expect(report.tier).toBe("mock");
  });

  it("reports the worker's own flag, not a constant", async () => {
    // `withService` arms it; a report that said `false` here would be reading
    // something other than `EIV_WORKER_ENABLED`.
    const report = await withService((service) =>
      service.checkConnection(courseSlug, undefined, actor()),
    );

    expect(report.submissionsEnabled).toBe(true);
  });

  it("still carries no password field of any kind", async () => {
    // The field added beside it must not have loosened this. A masked secret
    // in a response is still a secret in a response (§4 invariant 7).
    const report = await withService((service) =>
      service.checkConnection(courseSlug, undefined, actor()),
    );

    expect(JSON.stringify(report)).not.toContain(VNR_PASSWORD);
  });
});

describe("the queue against the accredited period (P184-01)", () => {
  /*
   * The client reached EIV's test system from the production host and the
   * event it described is accredited **14–19 January 2024**. Every completion
   * today is therefore refused with a 406 — one per physician, for ever — and
   * the platform had both numbers in its hands without comparing them.
   *
   * `reportableOn` is exhaustively unit-tested in `@ds/domain`. These name its
   * caller (§9.7): a rule nothing calls is what `inviteStatus` was, and a test
   * of that rule would pass on a product that never consults it.
   */
  it("says nothing is outside a period that spans the queue", async () => {
    // A queued row of this test's own — never one left by an earlier case,
    // whose status a later one may have changed (§9.6's fixture half).
    await seedSubmission({ status: "queued", eventEndAt: new Date("2026-09-04") });

    // The fixture's mock event runs 2020→2099, so every row is inside it. The
    // silent case matters as much as the loud one: a check that always warns
    // is one an operator learns to skip.
    const report = await withService((service) =>
      service.checkConnection(courseSlug, undefined, actor()),
    );

    expect(report.queue?.pending).toBeGreaterThan(0);
    expect(report.queue?.beforePeriod).toBe(0);
    expect(report.queue?.afterPeriod).toBe(0);
  });

  it("counts the ones the register will refuse, and names the days", async () => {
    // The client's situation, reproduced: a five-day event that closed in
    // January 2024, and a completion long after it.
    await seedSubmission({ status: "queued", eventEndAt: new Date("2026-09-04") });

    const closed = await startMockServer(0, {
      eventBeginn: "2024-01-15",
      eventEnde: "2024-01-20",
    });
    try {
      const report = await withService(
        (service) => service.checkConnection(courseSlug, undefined, actor()),
        { baseUrl: closed.url },
      );

      expect(report.queue?.pending).toBeGreaterThan(0);
      expect(report.queue?.afterPeriod).toBe(report.queue?.pending);
      expect(report.queue?.beforePeriod).toBe(0);
      // Berlin's calendar day, which is what EIV compares against.
      expect(report.queue?.latestDay).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    } finally {
      await closed.close();
    }
  });

  it("omits the verdict entirely when the event could not be read", async () => {
    // No period means nothing to compare against, and a `0` would read as
    // "all fine" — the §9.6 shape this whole field exists to avoid.
    const report = await withService(
      (service) => service.checkConnection(courseSlug, undefined, actor()),
      { baseUrl: "http://127.0.0.1:1" },
    );

    expect(report.steps.find((step) => step.step === "event")?.ok).toBe(false);
    expect(report.queue).toBeUndefined();
  });
});

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
                            pass_threshold_percent, status)
       SELECT customer_id, project_id, $2, 'No VNR', 100, 70, 'published' FROM courses WHERE id = $1`,
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

  /**
   * P118. The requeue used to keep the EFN frozen at completion while the
   * certificate read `efn_profiles` live, so an operator repairing a typo got a
   * certificate with the new number and a Meldung with the old — and both
   * reported success.
   */
  it("adopts the physician's corrected EFN, because nothing was reported", async () => {
    const CORRECTED = "802760699000001";
    const { enrolmentId, submissionId, userId } = await seedSubmission({
      status: "failed_permanent",
      efn: "802760699999999",
    });

    // What the physician does themselves in the portal — support has no path
    // to this table and must not (ADR-0004).
    await seedPool.query(
      `INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET efn = EXCLUDED.efn`,
      [userId, CORRECTED],
    );

    await withService((s) => s.requeue(enrolmentId, actor(), new Date()));

    const { rows } = await seedPool.query<{ efn: string; status: string }>(
      "SELECT efn, status FROM eiv_submissions WHERE id = $1",
      [submissionId],
    );
    expect(rows[0]?.efn).toBe(CORRECTED);
    expect(rows[0]?.status).toBe("queued");
  });

  it("refuses to re-file under a new EFN once the old one was accepted", async () => {
    /*
     * S30. Correcting a name changes how one physician is described;
     * correcting an EFN changes which physician was credited, and the points
     * already on the first record cannot be taken back from here. A refusal is
     * the right answer to an unanswered rule; filing a guess is not.
     */
    const { enrolmentId, submissionId, userId } = await seedSubmission({
      status: "submitted",
      efn: "802760699999999",
    });
    await seedPool.query(
      `INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET efn = EXCLUDED.efn`,
      [userId, "802760699000002"],
    );

    await expect(
      withService((s) => s.requeue(enrolmentId, actor(), new Date())),
    ).rejects.toMatchObject({ kind: "conflict" });

    // And it changed nothing on the way out.
    const { rows } = await seedPool.query<{ efn: string; status: string }>(
      "SELECT efn, status FROM eiv_submissions WHERE id = $1",
      [submissionId],
    );
    expect(rows[0]?.efn).toBe("802760699999999");
    expect(rows[0]?.status).toBe("submitted");
  });

  it("still requeues an accepted row whose EFN has not moved", async () => {
    // The control. A requeue after acceptance is a legitimate correction of
    // something else, and refusing it over an EFN that did not change would be
    // a refusal with no defect behind it (§9.2, inverted).
    const { enrolmentId, submissionId, userId } = await seedSubmission({
      status: "submitted",
      efn: "802760699999998",
    });
    await seedPool.query(
      `INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)
       ON CONFLICT (user_id) DO UPDATE SET efn = EXCLUDED.efn`,
      [userId, "802760699999998"],
    );

    await withService((s) => s.requeue(enrolmentId, actor(), new Date()));

    const { rows } = await seedPool.query<{ status: string }>(
      "SELECT status FROM eiv_submissions WHERE id = $1",
      [submissionId],
    );
    expect(rows[0]?.status).toBe("queued");
  });

  it("keeps the submission's own EFN when the subject has been erased", async () => {
    // Erasure deletes `efn_profiles` and leaves a submission still owed. There
    // is nothing newer to adopt, and a LEFT join is what stops "no profile"
    // reading as "no submission" (§9.6).
    const { enrolmentId, submissionId } = await seedSubmission({
      status: "failed_permanent",
      efn: "802760699999997",
    });

    await withService((s) => s.requeue(enrolmentId, actor(), new Date()));

    const { rows } = await seedPool.query<{ efn: string }>(
      "SELECT efn FROM eiv_submissions WHERE id = $1",
      [submissionId],
    );
    expect(rows[0]?.efn).toBe("802760699999997");
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
