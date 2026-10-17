/**
 * The two sweep claims, under the concurrency they exist for (TEST-3, P250-01).
 *
 * ## Why this file exists
 *
 * `claim_due_eiv_submissions` (migration 0005) and
 * `claim_due_certificate_deliveries` (0012) hand out work to every API instance
 * that sweeps. Two instances claiming the same Punktemeldung report one
 * physician's participation to the Ärztekammer twice; two claiming the same
 * certificate mail it twice. What stops that is one clause in each,
 * `FOR UPDATE SKIP LOCKED`, and until this file nothing tested it at all: the
 * worker suites call the claim once, from one connection, which passes
 * identically with or without the clause (CLAUDE.md §11 rule 10).
 *
 * ## How the race is made to happen every time
 *
 * Three `ds_app` connections each open a transaction, call the claim and then
 * **hold the transaction open** until every other caller has either returned
 * or is visibly blocked on a row lock (`pg_stat_activity.wait_event_type =
 * 'Lock'`). Only then does each commit. So the claims overlap by construction
 * rather than by timing:
 *
 * - With `SKIP LOCKED`, the first caller locks the row and the other two skip
 *   it and return nothing.
 * - Without it, the other two read the row as due, block on the first caller's
 *   lock, and — once it commits — update the row anyway and return it. The id
 *   appears three times.
 *
 * The second half is not left to a comment. The last describe derives a copy
 * of each shipped function **minus** that clause, straight from
 * `pg_get_functiondef`, and asserts this same harness sees the duplicate. A
 * harness that could not observe a double claim would make the exactly-once
 * assertions above it worthless (§9.1); this one shows that it can.
 *
 * Fixtures are created under one customer made here, and every assertion is
 * about the ids this file created (§9.6).
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { createPool } from "@ds/postgres";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const DATABASE_URL = requireEnv("DATABASE_URL");

/** More than one, so "exactly once" is a claim about a race and not a tautology. */
const CALLERS = 3;

let seedPool: Pool;
let appPool: Pool;

let customerId: string;
let courseId: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  appPool = createPool({ connectionString: DATABASE_URL, max: CALLERS + 2 });

  const suffix = randomUUID().slice(0, 8);
  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`claims-${suffix}`, "Claim Concurrency GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [customerId, departmentId, `claims-project-${suffix}`, "Claims project"],
  );
  courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,100,70,'published') RETURNING id`,
    [customerId, projectId, `claims-course-${suffix}`, "Claims course"],
  );
}, 30_000);

afterAll(async () => {
  await seedPool.query("DROP FUNCTION IF EXISTS claim_due_eiv_submissions_unlocked");
  await seedPool.query(
    "DROP FUNCTION IF EXISTS claim_due_certificate_deliveries_unlocked",
  );
  await appPool.end();
  await seedPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

/** A completed enrolment on this file's course, for a learner made for it. */
async function seedEnrolment(): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const { id: userId } = await seedLearner(seedPool, {
    realm: `http://127.0.0.1/realms/claims-${suffix}`,
    subject: `claims-${suffix}`,
  });
  return insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, completed_at)
     VALUES ($1,$2,$3,100,70,now()) RETURNING id`,
    [customerId, courseId, userId],
  );
}

/** One Punktemeldung, due now: queued, never attempted, no lease. */
async function seedDueSubmission(): Promise<string> {
  const enrolmentId = await seedEnrolment();
  return insert(
    `INSERT INTO eiv_submissions (customer_id, enrolment_id, vnr, efn, event_end_at,
                                  report_due_at, status)
     VALUES ($1,$2,'9999999999999999999','802760699999990',now(),
             now() + interval '8 days','queued') RETURNING id`,
    [customerId, enrolmentId],
  );
}

/** One issued certificate, never delivered, no lease. */
async function seedDueCertificate(): Promise<string> {
  const enrolmentId = await seedEnrolment();
  return insert(
    `INSERT INTO certificates (customer_id, enrolment_id, status, participant_name,
                               issued_at, delivery_attempt_count)
     VALUES ($1,$2,'issued','Dr. med. Erika Musterfrau',now(),0) RETURNING id`,
    [customerId, enrolmentId],
  );
}

type ClaimFunction =
  | "claim_due_eiv_submissions"
  | "claim_due_certificate_deliveries"
  | "claim_due_eiv_submissions_unlocked"
  | "claim_due_certificate_deliveries_unlocked";

/**
 * Fire `CALLERS` claims at once, each on its own connection in its own open
 * transaction, and return every id each one was handed.
 *
 * Each caller commits only once every other caller has returned or is blocked
 * on a lock — see the file header for why that makes the overlap certain.
 */
async function race(fn: ClaimFunction): Promise<string[][]> {
  const clients: PoolClient[] = [];
  for (let i = 0; i < CALLERS; i += 1) clients.push(await appPool.connect());

  try {
    const pids = await Promise.all(
      clients.map(async (client) => {
        const { rows } = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        return rows[0]?.pid ?? -1;
      }),
    );
    const returned = new Set<number>();

    const othersSettled = async (self: number): Promise<void> => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const others = pids.filter((pid) => pid !== self && !returned.has(pid));
        if (others.length === 0) return;

        const { rows } = await seedPool.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity
            WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'`,
          [others],
        );
        if (rows.length === others.length) return;

        if (Date.now() > deadline) {
          throw new Error(
            `claim race: ${String(others.length - rows.length)} caller(s) neither ` +
              "returned nor blocked on a lock within 10 s",
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    return await Promise.all(
      clients.map(async (client, index) => {
        const pid = pids[index] ?? -1;
        await client.query("BEGIN");
        const { rows } = await client.query<{
          submission_id?: string;
          certificate_id?: string;
        }>(`SELECT * FROM ${fn}(100, now(), 60)`);
        returned.add(pid);
        await othersSettled(pid);
        await client.query("COMMIT");
        return rows.map((row) => row.submission_id ?? row.certificate_id ?? "");
      }),
    );
  } finally {
    for (const client of clients) client.release();
  }
}

/** How many times `id` was handed out across every caller. */
function timesClaimed(results: readonly string[][], id: string): number {
  return results.flat().filter((claimed) => claimed === id).length;
}

describe("claim_due_eiv_submissions under concurrent sweeps", () => {
  it("hands one due Punktemeldung to exactly one of three concurrent callers", async () => {
    const submissionId = await seedDueSubmission();

    const results = await race("claim_due_eiv_submissions");

    expect(timesClaimed(results, submissionId)).toBe(1);
  });
});

describe("claim_due_certificate_deliveries under concurrent sweeps", () => {
  it("hands one due certificate to exactly one of three concurrent callers", async () => {
    const certificateId = await seedDueCertificate();

    const results = await race("claim_due_certificate_deliveries");

    expect(timesClaimed(results, certificateId)).toBe(1);
  });
});

describe("the harness can see a double claim (the control)", () => {
  /*
   * A copy of each shipped function with `FOR UPDATE SKIP LOCKED` removed and
   * nothing else changed — derived from the live definition, so it follows the
   * migration if the migration ever changes. Created under a different name
   * and dropped in `afterAll`; the shipped functions are never touched.
   *
   * If the clause is not found exactly once the derivation throws, because a
   * copy identical to the original would make this control pass for the wrong
   * reason.
   */
  async function createUnlockedCopy(
    shipped: "claim_due_eiv_submissions" | "claim_due_certificate_deliveries",
  ): Promise<void> {
    const signature = `${shipped}(integer, timestamptz, integer)`;
    const { rows } = await seedPool.query<{ def: string }>(
      "SELECT pg_get_functiondef($1::regprocedure) AS def",
      [signature],
    );
    const original = rows[0]?.def ?? "";

    const clause = /\s+FOR UPDATE SKIP LOCKED/gu;
    const occurrences = original.match(clause)?.length ?? 0;
    if (occurrences !== 1) {
      throw new Error(
        `${shipped}: expected one FOR UPDATE SKIP LOCKED, found ${occurrences}`,
      );
    }

    const copy = original
      .replace(clause, "")
      .replace(`FUNCTION public.${shipped}(`, `FUNCTION public.${shipped}_unlocked(`);
    if (!copy.includes(`${shipped}_unlocked(`)) {
      throw new Error(`${shipped}: could not rename the copy`);
    }

    await seedPool.query(copy);
    await seedPool.query(
      `ALTER FUNCTION ${shipped}_unlocked(integer, timestamptz, integer)
         OWNER TO ds_binding_resolver`,
    );
    await seedPool.query(
      `GRANT EXECUTE ON FUNCTION ${shipped}_unlocked(integer, timestamptz, integer)
         TO ds_app`,
    );
  }

  it("sees a Punktemeldung claimed more than once without SKIP LOCKED", async () => {
    await createUnlockedCopy("claim_due_eiv_submissions");
    const submissionId = await seedDueSubmission();

    const results = await race("claim_due_eiv_submissions_unlocked");

    expect(timesClaimed(results, submissionId)).toBeGreaterThan(1);
  });

  it("sees a certificate claimed more than once without SKIP LOCKED", async () => {
    await createUnlockedCopy("claim_due_certificate_deliveries");
    const certificateId = await seedDueCertificate();

    const results = await race("claim_due_certificate_deliveries_unlocked");

    expect(timesClaimed(results, certificateId)).toBeGreaterThan(1);
  });
});
