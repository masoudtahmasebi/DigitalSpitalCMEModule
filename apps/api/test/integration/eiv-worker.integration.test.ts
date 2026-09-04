/**
 * The EIV submission worker against the real mock server (P7-06).
 *
 * The service unit tests use a faked submitter, so they prove the retry policy
 * is wired correctly. This suite proves the parts only real infrastructure can:
 * the `FOR UPDATE SKIP LOCKED` claim query actually runs, the status enum
 * values the repository writes actually exist, and a full submit round trip
 * against the mock produces the reference the schema stores.
 *
 * The mock is `@ds/eiv-client`'s own — the same double the client's contract
 * tests use, so a change to the EIV contract breaks one place, not two.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { startMockServer, type MockServer } from "@ds/eiv-client";
import { AuditService } from "../../src/audit/audit.service.js";
import { PlaintextSecretCipher } from "../../src/shared/secret-cipher.js";
import { EivRepository } from "../../src/modules/eiv/eiv.repository.js";
import { EivService } from "../../src/modules/eiv/eiv.service.js";
import { EivAccreditationReporter } from "@ds/eiv-client";
import { EivAlertRepository } from "../../src/modules/eiv/eiv-alert.repository.js";
import { EivAlertService } from "../../src/modules/eiv/eiv-alert.service.js";
import { seedLearner } from "./support/seed-learner.js";
import { eivDeadlines } from "@ds/domain";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const DATABASE_URL = requireEnv("DATABASE_URL");

const EFN = "987654321098765";
const VNR = "9999999999999999999";
const VNR_PASSWORD = "mock-vnr-password";
const cipher = new PlaintextSecretCipher("test");

let seedPool: Pool;
let appPool: Pool;
let mock: MockServer;

let customerId: string;
let courseId: string;
let userId: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  appPool = createPool({ connectionString: DATABASE_URL, max: 5 });
  mock = await startMockServer(0);

  const suffix = randomUUID().slice(0, 8);

  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`eiv-customer-${suffix}`, "EIV Worker GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [customerId, departmentId, `eiv-project-${suffix}`, "EIV project"],
  );
  courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, vnr, vnr_password_enc, status)
     VALUES ($1,$2,$3,$4,100,70,$5,$6,'published') RETURNING id`,
    [
      customerId,
      projectId,
      `eiv-course-${suffix}`,
      "EIV course",
      VNR,
      cipher.encrypt(VNR_PASSWORD),
    ],
  );
  userId = (
    await seedLearner(seedPool, {
      realm: `http://127.0.0.1/realms/eiv-${suffix}`,
      subject: `eiv-sub-${suffix}`,
    })
  ).id;

  /*
   * The sweep is global by design — it drains every tenant's queue — so this
   * suite's tally counts whatever else is queued.
   *
   * This used to park other customers' rows before starting, because the suite
   * ran against a database shared with development and with every previous
   * run. Since P32-01 the run begins from an empty database, so the only rows
   * here are the ones this file creates. The parking is kept, narrowed to a
   * comment about *why* it is no longer needed: a suite that silently depends
   * on being alone should say so, and this one genuinely does.
   */
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

/** A completed enrolment with a queued submission, ready for the worker. */
async function queueSubmission(
  over: { eventEndAt?: Date; attemptCount?: number; lastError?: string } = {},
): Promise<{ submissionId: string; enrolmentId: string }> {
  const eventEndAt = over.eventEndAt ?? new Date();

  const enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, completed_at)
     VALUES ($1,$2,$3,100,70,$4) RETURNING id`,
    [customerId, courseId, userId, eventEndAt],
  );

  // A fresh user per enrolment: enrolments are unique on (course_id, user_id).
  const submissionId = await insert(
    `INSERT INTO eiv_submissions (customer_id, enrolment_id, vnr, efn, event_end_at,
                                  report_due_at, attempt_count, last_error, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      customerId,
      enrolmentId,
      VNR,
      EFN,
      eventEndAt,
      new Date(eventEndAt.getTime() + 8 * 86_400_000),
      over.attemptCount ?? 0,
      over.lastError ?? null,
      over.attemptCount === undefined ? "queued" : "failed_retryable",
    ],
  );

  return { submissionId, enrolmentId };
}

/** Each enrolment needs its own user, so mint one per scenario. */
async function freshUser(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  userId = (
    await seedLearner(seedPool, {
      realm: `http://127.0.0.1/realms/eiv-${suffix}`,
      subject: `eiv-sub-${suffix}`,
    })
  ).id;
}

/**
 * The service, plus the sweep target it is driven with (P180-01).
 *
 * `baseUrl` and `allowLive` are a **sweep** argument now, not constructor
 * options: they come from `platform_settings`, which an operator edits while
 * the process runs, so the worker asks for them on every tick. `buildService`
 * still returns the service for the two cases that call `sweep` themselves; the
 * rest go through `sweepWith`.
 */
function buildService(): EivService {
  return new EivService(
    new EivRepository(appPool, new PlaintextSecretCipher("test")),
    new EivAccreditationReporter(),
    new AuditService(appPool),
    { batchSize: 25, leaseSeconds: 120 },
  );
}

function target(allowLive = false, baseUrl = mock.url) {
  return { baseUrl, allowLive };
}

async function readSubmission(id: string) {
  const { rows } = await seedPool.query<{
    status: string;
    attempt_count: number;
    external_reference: string | null;
    first_submitted_at: Date | null;
    next_attempt_at: Date | null;
    last_error: string | null;
  }>(
    `SELECT status, attempt_count, external_reference, first_submitted_at,
            next_attempt_at, last_error
       FROM eiv_submissions WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

/**
 * How many rows the worker ought to claim, right now.
 *
 * The predicate is `claim_due_eiv_submissions`' own, written out here from
 * migration 0005 rather than shared with it — an independent statement of the
 * same rule, which is the only version worth asserting against.
 *
 * **Why this is not simply `1` (P32-02).** `EivService.sweep` is global by
 * design: a reporting deadline does not care whose tenant it belongs to, and a
 * per-tenant sweep would need something to enumerate tenants, which is the
 * design the worker exists to avoid. So `considered` is a fact about the whole
 * database, and a hard-coded `1` is really the claim "this suite is the only
 * thing in this database" — a property of the harness, asserted here by
 * accident, in a test about the worker.
 *
 * That claim broke in CI twice, and the assertion it broke had nothing to do
 * with what the test was for. Counting instead keeps every bit of the original
 * meaning — a worker that claimed a row it should not have, or skipped one it
 * should have taken, still fails — and drops the part that was never this
 * test's business.
 */
async function countDue(now: Date): Promise<number> {
  const { rows } = await seedPool.query<{ n: string }>(
    `SELECT count(*) AS n
       FROM eiv_submissions
      WHERE status IN ('queued', 'failed_retryable')
        AND (next_attempt_at IS NULL OR next_attempt_at <= $1)`,
    [now],
  );
  return Number(rows[0]?.n ?? 0);
}

describe("the worker submits a queued participation", () => {
  it("submits against the mock and stores the reference", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission();

    const now = new Date();
    const due = await countDue(now);
    const result = await buildService().sweep(now, target());

    // The sweep claimed exactly the rows that were claimable, and reported at
    // least one submission. What was submitted is asserted on the row below,
    // which is where this suite's own claim actually lives — `submitted` is a
    // count across every tenant and says nothing about *whose*.
    expect(result.considered).toBe(due);
    expect(result.submitted).toBeGreaterThanOrEqual(1);

    const row = await readSubmission(submissionId);
    expect(row.status).toBe("submitted");
    expect(row.attempt_count).toBe(1);
    // EIV issues no reference — the column stays null for this authority, and
    // the port keeps it only because another Ärztekammer might (P31-01).
    expect(row.external_reference).toBeNull();
    expect(row.first_submitted_at).not.toBeNull();
    expect(row.last_error).toBeNull();
  });

  it("delivered a Meldung shaped as the real interface requires (P31-01)", async () => {
    // The mock records what it received, which is how we know the payload was
    // shaped as the EIV contract requires rather than merely accepted.
    //
    // There is no `rolle` and no `vnr` in the body any more: the specification
    // has neither, because the VNR is carried by the token. The mock therefore
    // attributes the record to the VNR it authenticated.
    const received = mock.submissions.at(-1);

    expect(received?.efn).toBe(EFN);
    expect(received?.punkteBasisFlag).toBe(1);
    expect(received?.punkteLernerfolgFlag).toBe(1);
    expect(received?.punkteReferent).toBe(0);
    // A German calendar date, checked against the accredited period by EIV.
    expect(received?.teilnahmedatum).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("does not pick up an already-submitted row on the next sweep", async () => {
    const before = mock.submissions.length;

    await buildService().sweep(new Date(), target());

    expect(mock.submissions.length).toBe(before);
  });

  it("writes an audit entry that carries no EFN", async () => {
    const { rows } = await seedPool.query<{ action: string; detail: unknown }>(
      `SELECT action, detail FROM audit_log
        WHERE customer_id = $1 AND action = 'eiv.submitted'
        ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(EFN);
  });
});

describe("the worker respects the statutory window", () => {
  it("marks a submission past the reporting deadline as window_closed", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission({
      eventEndAt: new Date(Date.now() - 30 * 86_400_000),
    });
    const before = mock.submissions.length;

    await buildService().sweep(new Date(), target());

    const row = await readSubmission(submissionId);
    expect(row.status).toBe("window_closed");
    expect(row.last_error).toBe("reporting_window_missed");
    // Never even attempted — the door is shut.
    expect(mock.submissions.length).toBe(before);
  });
});

describe("the worker refuses a live endpoint by default", () => {
  it("abandons rather than submitting to a non-local base URL", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission();

    const service = new EivService(
      new EivRepository(appPool, new PlaintextSecretCipher("test")),
      new EivAccreditationReporter(),
      new AuditService(appPool),
      { batchSize: 25, leaseSeconds: 120 },
    );

    await service.sweep(new Date(), target(false, "https://punktemeldung.eiv-fobi.de/"));

    const row = await readSubmission(submissionId);
    expect(row.status).toBe("failed_permanent");
    expect(row.last_error).toBe("live_submission_not_allowed");
  });
});

/**
 * The deadline alarm (P10-06, CLAUDE.md §4 invariant 8), against real SQL.
 *
 * The unit tests cover the decision. What can only be checked here is that the
 * two queries behind it are right: that a `queued` submission approaching its
 * deadline is actually found, and that the escalation history really is read
 * back out of the append-only audit log.
 *
 * That second one matters more than it looks. If `findAlertedLevels` silently
 * returned nothing — a wrong `detail->>'level'`, a type mismatch on the id —
 * every sweep would re-raise the same alert, and the channel it goes to would
 * be muted within a day. A muted alert is worse than none, because it is
 * believed to be working.
 */
describe("the deadline alarm finds what it needs to find", () => {
  function alertService(sink?: { send: (alert: unknown) => Promise<void> }) {
    return new EivAlertService(
      new EivAlertRepository(appPool),
      new AuditService(appPool),
      { error: () => {}, warn: () => {} },
      sink as never,
    );
  }

  /** Only this suite's own rows — other suites share this database. */
  function mine<T extends { enrolmentId: string }>(
    alerts: readonly T[],
    ids: readonly string[],
  ): T[] {
    return alerts.filter((alert) => ids.includes(alert.enrolmentId));
  }

  it("does not raise anything for a submission with days to run", async () => {
    await freshUser();
    // Due in 8 days, which is what a freshly completed course looks like.
    const { enrolmentId } = await queueSubmission();

    const raised = await alertService().sweep(new Date());

    expect(mine(raised, [enrolmentId])).toEqual([]);
  });

  it("raises, and records the level in the audit log", async () => {
    await freshUser();
    // Event ended 7 days ago: 8-day window, so ~24 h remain.
    const eventEndAt = new Date(Date.now() - 7 * 86_400_000);
    const { enrolmentId } = await queueSubmission({ eventEndAt });

    const sent: Array<{ level: string }> = [];
    const raised = await alertService({
      send: async (alert) => void sent.push(alert as { level: string }),
    }).sweep(new Date());

    expect(mine(raised, [enrolmentId])).toHaveLength(1);
    expect(sent.some((alert) => alert.level === "warning")).toBe(true);

    const { rows } = await seedPool.query<{ detail: { level: string } }>(
      "SELECT detail FROM audit_log WHERE action = 'eiv.deadline_alert' AND subject = $1",
      [enrolmentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail.level).toBe("warning");
  });

  it("stays silent on the next sweep, reading its own audit trail", async () => {
    await freshUser();
    const eventEndAt = new Date(Date.now() - 7 * 86_400_000);
    const { enrolmentId } = await queueSubmission({ eventEndAt });

    const service = alertService();
    expect(mine(await service.sweep(new Date()), [enrolmentId])).toHaveLength(1);
    expect(mine(await service.sweep(new Date()), [enrolmentId])).toEqual([]);

    // Exactly one row, not two: the second sweep wrote nothing.
    const { rows } = await seedPool.query(
      "SELECT 1 FROM audit_log WHERE action = 'eiv.deadline_alert' AND subject = $1",
      [enrolmentId],
    );
    expect(rows).toHaveLength(1);
  });

  it("escalates when the same submission gets closer", async () => {
    await freshUser();
    const eventEndAt = new Date(Date.now() - 7 * 86_400_000);
    const { enrolmentId } = await queueSubmission({ eventEndAt });

    const service = alertService();
    await service.sweep(new Date());

    /*
     * Six hours before the deadline, which is inside the 12-hour threshold.
     *
     * The instant is computed from `eivDeadlines` rather than written as "20
     * hours later" (P58-02): the deadline is the *end of a Berlin day*, so how
     * far away it is depends on the time of day the suite runs — and the
     * fixed offset this case used to carry only landed inside the threshold
     * for part of the day. What is asserted here is the escalation, not the
     * arithmetic; the arithmetic has its own exhaustive tests.
     */
    const deadline = eivDeadlines({ eventEndAt, now: new Date() }).reportDueAt;
    const later = new Date(deadline.getTime() - 6 * 3_600_000);
    const raised = mine(await service.sweep(later), [enrolmentId]);

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ level: "urgent" });
  });

  it("ignores a submission that has already been reported", async () => {
    await freshUser();
    const eventEndAt = new Date(Date.now() - 7 * 86_400_000);
    const { submissionId, enrolmentId } = await queueSubmission({ eventEndAt });

    await seedPool.query(
      "UPDATE eiv_submissions SET status = 'submitted' WHERE id = $1",
      [submissionId],
    );

    expect(mine(await alertService().sweep(new Date()), [enrolmentId])).toEqual([]);
  });

  it("ignores a Meldung that was deliberately withdrawn (P33-01)", async () => {
    /*
     * `unreported_eiv_submissions` selected `status <> 'submitted'` from
     * migration 0011, when reported and unreported were the only outcomes.
     * P31-02 added `withdrawn` — reported, then retracted on purpose inside the
     * correction window, which EIV keeps with its points zeroed.
     *
     * Under the old predicate that is permanently "unreported": nothing ever
     * moves it to `submitted`, so it would escalate warning, urgent and overdue
     * at whoever is on call, about a decision a named human made and recorded.
     * Three false alarms per withdrawal, and this file's own service says an
     * alerting path nobody trusts is worse than none.
     *
     * Only a real Postgres can check this — the predicate is in SQL.
     */
    await freshUser();
    const eventEndAt = new Date(Date.now() - 7 * 86_400_000);
    const { submissionId, enrolmentId } = await queueSubmission({ eventEndAt });

    await seedPool.query(
      "UPDATE eiv_submissions SET status = 'withdrawn' WHERE id = $1",
      [submissionId],
    );

    expect(mine(await alertService().sweep(new Date()), [enrolmentId])).toEqual([]);
  });

  it("wakes somebody the moment the worker abandons a row, not six days later", async () => {
    /*
     * The complement of the test above, and the reason `blocked` exists: a
     * submission with a week still on its clock that the worker has given up on
     * — no VNR password on the course, an unknown VNR, a refused endpoint.
     *
     * The clock-based levels say nothing until 48 hours remain. This row will
     * not fix itself in the meantime, and six days is the difference between
     * setting a password and invoking the Bescheid's paper fallback.
     */
    await freshUser();
    const { submissionId, enrolmentId } = await queueSubmission();

    await seedPool.query(
      "UPDATE eiv_submissions SET status = 'failed_permanent', last_error = $2 WHERE id = $1",
      [submissionId, "missing_vnr_password"],
    );

    const raised = mine(await alertService().sweep(new Date()), [enrolmentId]);

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ level: "blocked" });
    // Days of window left, which is exactly why nothing else would have spoken.
    expect(raised[0]?.hoursRemaining).toBeGreaterThan(48);
  });
});

describe("a failed attempt is audited too (QA §7.9, CLAUDE.md §4 invariant 8)", () => {
  /*
   * The invariant is "**every** EIV submission attempt is written to an
   * append-only audit log, **including failures**". Only the success half was
   * asserted — `eiv.submitted`, above — and a suite that proves the happy path
   * writes a row proves nothing about the path that matters most.
   *
   * A failure is the case an auditor actually asks about: a Punktemeldung that
   * did not land, on a physician's record, against a statutory deadline. If
   * that attempt leaves no trace, the log answers "we never tried", which is
   * both false and unfalsifiable.
   *
   * The failure is produced by pointing the worker at a **closed local port**
   * rather than by asking the mock to misbehave: the mock's `x-mock-behaviour`
   * switch is a request header the harness sets and the worker does not, so
   * using it here would test the harness. A refused connection is what an
   * unreachable EIV-FOBI looks like from this process, and `127.0.0.1` stays
   * inside the `allowLive` guard.
   */
  it("records eiv.attempt_failed, carrying neither the EFN nor the VNR password", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission();

    // Port 1 is reserved and nothing listens on it: connect() is refused
    // immediately, so this costs no wall-clock time.
    const unreachable = new EivService(
      new EivRepository(appPool, new PlaintextSecretCipher("test")),
      new EivAccreditationReporter(),
      new AuditService(appPool),
      { batchSize: 25, leaseSeconds: 120 },
    );

    await unreachable.sweep(new Date(), target(false, "http://127.0.0.1:1"));

    const row = await readSubmission(submissionId);
    expect(row.status).not.toBe("submitted");
    expect(row.attempt_count).toBeGreaterThanOrEqual(1);

    const { rows } = await seedPool.query<{ action: string; detail: unknown }>(
      `SELECT action, detail FROM audit_log
        WHERE customer_id = $1 AND action = 'eiv.attempt_failed'
        ORDER BY created_at DESC LIMIT 1`,
      [customerId],
    );

    expect(rows, "a failed attempt left no audit row").toHaveLength(1);

    const detail = JSON.stringify(rows[0]!.detail);
    // ADR-0004: the EFN never reaches a log, an audit detail, or an error
    // message. Neither does the VNR password (§4 invariant 7).
    expect(detail).not.toContain(EFN);
    expect(detail).not.toContain(VNR_PASSWORD);
    // And it says enough to act on: which attempt, and why it failed.
    expect(detail).toMatch(/attemptCount/u);
    expect(detail).toMatch(/failure/u);
  });
});

/*
 * A corrected VNR, and the queued Punktemeldungen that still carry the old one
 * (P186-01).
 *
 * `eiv_submissions.vnr` is a snapshot written at completion. `vnr_password_enc`,
 * `eiv_punkte_basis` and `eiv_punkte_lernerfolg` in the same `load` query are
 * read live from `courses`. So one row authenticates with **last week's VNR and
 * this week's password**.
 *
 * That is CLAUDE.md §9.10b, the class the client already named twice:
 *
 *   > How can you set these hard coded when there are values in course!
 *
 * A VNR is not what the learner did. It is what the event *is* — the number the
 * Ärztekammer accredited — and correcting a typo in Verwaltung has to correct
 * every Punktemeldung not yet filed. The ones already filed are history and
 * `alreadySubmitted` protects them (ADR-0005); a queued row is not history.
 *
 * The mock refuses authentication with a VNR other than `expectedVnr`, exactly
 * as the real interface answers 401 — so this suite can tell which number the
 * worker actually presented, rather than which one it stored.
 */
describe("a VNR corrected after somebody completed (P186-01)", () => {
  const CORRECTED = "8888888888888888888";
  let strict: MockServer;

  beforeAll(async () => {
    strict = await startMockServer(0, {
      expectedVnr: CORRECTED,
      expectedPassword: VNR_PASSWORD,
    });
  });

  afterAll(async () => {
    await strict?.close();
  });

  it("files the Meldung against the course's current VNR, not the queued copy", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission();

    // The operator fixes a mistyped VNR in Verwaltung. The password is
    // unchanged: the correction is one digit, not a different registration.
    await seedPool.query("UPDATE courses SET vnr = $1 WHERE id = $2", [
      CORRECTED,
      courseId,
    ]);

    await buildService().sweep(new Date(), { baseUrl: strict.url, allowLive: false });

    const row = await readSubmission(submissionId);
    expect(row.status).toBe("submitted");
    // The record the register holds is attributed to the VNR that
    // authenticated. Against the old number the mock answers 401 and this is
    // `failed_retryable` with nothing filed.
    expect(strict.submissions.at(-1)?.vnr).toBe(CORRECTED);
  });

  /*
   * And the row says what was filed. Before P186-01 the stored copy was the
   * only VNR anywhere, so leaving it at the completion-time value would have
   * the console report a Punktemeldung against a registration that never
   * received one — and a retraction has to name the number it was filed under
   * (ADR-0005).
   */
  it("stores the number that actually authenticated", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission();

    await seedPool.query("UPDATE courses SET vnr = $1 WHERE id = $2", [
      CORRECTED,
      courseId,
    ]);
    await buildService().sweep(new Date(), { baseUrl: strict.url, allowLive: false });

    const { rows } = await seedPool.query<{ vnr: string; status: string }>(
      "SELECT vnr, status FROM eiv_submissions WHERE id = $1",
      [submissionId],
    );
    expect(rows[0]?.status).toBe("submitted");
    expect(rows[0]?.vnr).toBe(CORRECTED);
  });

  /*
   * The other direction, and the one that must not fall back. An operator who
   * clears the VNR has said this course is not the accredited event they
   * thought it was. Filing against the number queued last week would be
   * irreversible, so the row is abandoned with a reason naming the course
   * setting to fix rather than anything the physician did.
   */
  it("abandons rather than filing against a VNR the operator removed", async () => {
    await freshUser();
    const { submissionId } = await queueSubmission();
    const before = strict.submissions.length;

    await seedPool.query("UPDATE courses SET vnr = NULL WHERE id = $1", [courseId]);
    await buildService().sweep(new Date(), { baseUrl: strict.url, allowLive: false });
    // Restore, so the ordering of cases in this describe cannot matter.
    await seedPool.query("UPDATE courses SET vnr = $1 WHERE id = $2", [
      CORRECTED,
      courseId,
    ]);

    const { rows } = await seedPool.query<{
      status: string;
      last_error: string | null;
      failure_kind: string | null;
    }>("SELECT status, last_error, failure_kind FROM eiv_submissions WHERE id = $1", [
      submissionId,
    ]);
    expect(rows[0]?.status).toBe("failed_permanent");
    expect(rows[0]?.last_error).toBe("missing_vnr");
    expect(rows[0]?.failure_kind).toBe("auth");
    // Nothing reached the register.
    expect(strict.submissions.length).toBe(before);
  });
});
