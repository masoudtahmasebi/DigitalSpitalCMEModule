/**
 * That N concurrent requests cannot deadlock a pool of N (P142-01).
 *
 * ## The outage this reproduces
 *
 * `TenantTransactionInterceptor` wraps the whole request in one pooled
 * connection. Several handlers then take a **second** one from the same pool,
 * because an audit row has to survive the rollback of the operation it audits
 * (`CLAUDE.md` §4 invariant 8) and because administering a customer means
 * entering a tenant that is not the request's.
 *
 * With `max: N`, N of those at once is a deadlock: every connection is held by
 * a request waiting for a connection. Nothing timed out, because `pg`'s default
 * checkout wait is for ever, and nothing was logged, because nothing failed.
 * The API answered `OPTIONS` in 30 ms — CORS middleware, no database — and left
 * every `GET` behind it `(pending)` with 0 bytes, for 22 hours, twice.
 *
 * ## Why this test can go red
 *
 * It builds a real pool of two and drives two concurrent operations shaped
 * exactly like a request: `runInTenant`, and an audit write inside it. Point
 * both at the same pool and it hangs — so the test is written with a deadline,
 * and the deadline failing *is* the defect. Point the audit at a second pool
 * and it passes in milliseconds.
 *
 * Watched red three ways before being trusted:
 *   1. audit on the request pool, guard removed  → both operations hang, the
 *      deadline fires (this is the production bug, exactly);
 *   2. audit on the request pool, guard in place → `PoolReentryError`;
 *   3. side pool wired correctly                → green.
 *
 * A unit test of `assertPoolNotHeld` alone would have proved nothing about the
 * product (§9.7): the rule was already implicit and nothing called it. The
 * caller is what is under test here, and `pool-wiring` below asserts the
 * wiring — that the app hands `AuditService` a pool that is *not* `PG_POOL` —
 * because a correct guard with the old wiring is a 500 instead of a hang, and
 * neither of those is a working platform.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import { AuditService } from "../../src/audit/audit.service.js";
import { runInTenant } from "../../src/db/tenant-db.js";
import { guardReentry, PoolReentryError } from "../../src/db/pool-reentry.js";
import { PG_POOL, PG_SIDE_POOL } from "../../src/db/tokens.js";
import { AppModule } from "../../src/app.module.js";
import { requireEnv } from "./support/env.js";

/** The superuser: this arranges a customer row, which RLS refuses to `ds_app`. */
const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const APP_URL = requireEnv("DATABASE_URL");

/**
 * Two, not ten. The deadlock's threshold is the pool size, so the smallest pool
 * that can have it makes the fastest, least flaky reproduction — and states the
 * bound the old comment got wrong: it is not "a pool of one", it is any N.
 */
const MAX = 2;

/**
 * Long enough that a working system is never near it, short enough that a
 * deadlocked one fails the suite rather than hanging CI until it is killed.
 */
const DEADLINE_MS = 8_000;

let admin: Pool;
let customerId: string;

beforeAll(async () => {
  admin = createPool({ connectionString: SUPERUSER_URL });
  customerId = randomUUID();
  await admin.query(`INSERT INTO customers (id, name, slug) VALUES ($1, $2, $3)`, [
    customerId,
    `Pool deadlock ${RUN()}`,
    `pool-deadlock-${RUN()}`,
  ]);
});

afterAll(async () => {
  await admin.query(`DELETE FROM audit_log WHERE customer_id = $1`, [customerId]);
  await admin.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
  await admin.end();
});

let runId: string | undefined;
function RUN(): string {
  runId ??= randomUUID().slice(0, 8);
  return runId;
}

/** One request, in the shape the interceptor gives it: transaction, then audit. */
async function oneRequest(requestPool: Pool, audit: AuditService): Promise<void> {
  await runInTenant(requestPool, { customerId, role: "system" }, async (db) => {
    // A real statement, so the connection is genuinely checked out and busy —
    // this is the SELECT that `pg_stat_activity` showed all ten sessions stuck
    // immediately after.
    await db.execute("SELECT 1");
    await audit.recordForCustomer(customerId, {
      actor: { identity: "system" },
      action: "pool.deadlock.probe",
    });
  });
}

/** Rejects rather than hanging, so a deadlock is a failure and not a timeout. */
async function within<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not finish within ${String(DEADLINE_MS)} ms`)),
      DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

describe("a pool of N under N concurrent requests", () => {
  it("completes when the audit writes on its own pool", async () => {
    const requestPool = guardReentry(
      createPool({ connectionString: APP_URL, max: MAX, connectionTimeoutMillis: 2_000 }),
      "request",
    );
    const sidePool = createPool({
      connectionString: APP_URL,
      max: MAX,
      connectionTimeoutMillis: 2_000,
    });
    const audit = new AuditService(sidePool);

    try {
      await within(
        Promise.all(Array.from({ length: MAX }, () => oneRequest(requestPool, audit))),
      );
    } finally {
      await Promise.allSettled([requestPool.end(), sidePool.end()]);
    }
  });

  it("refuses the second checkout rather than waiting for one that cannot come", async () => {
    /*
     * The same arrangement with the audit pointed back at the request pool —
     * which is what shipped. Without the guard every one of these hangs for
     * ever; with it, each fails immediately and says which call site did it.
     *
     * Asserted as `PoolReentryError` rather than "it did not hang", because
     * "it did not hang" is also true of a 5-second checkout timeout, and a
     * platform that answers 500 five seconds later is not the fix.
     */
    const requestPool = guardReentry(
      createPool({ connectionString: APP_URL, max: MAX, connectionTimeoutMillis: 2_000 }),
      "request",
    );
    const audit = new AuditService(requestPool);

    try {
      await within(
        expect(oneRequest(requestPool, audit)).rejects.toThrow(PoolReentryError),
      );
    } finally {
      await requestPool.end();
    }
  });

  it("still writes the audit row, which is the reason it needs its own connection", async () => {
    const requestPool = guardReentry(
      createPool({ connectionString: APP_URL, max: MAX }),
      "request",
    );
    const sidePool = createPool({ connectionString: APP_URL, max: MAX });
    const audit = new AuditService(sidePool);
    const action = `pool.audit.survives.${randomUUID().slice(0, 8)}`;

    try {
      // The request rolls back; the audit row must not.
      await expect(
        runInTenant(requestPool, { customerId, role: "system" }, async () => {
          await audit.recordForCustomer(customerId, {
            actor: { identity: "system" },
            action,
          });
          throw new Error("the operation this audited failed");
        }),
      ).rejects.toThrow("the operation this audited failed");

      const { rows } = await admin.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE action = $1`,
        [action],
      );
      expect(rows[0]).toEqual({ n: 1 });
    } finally {
      await Promise.allSettled([requestPool.end(), sidePool.end()]);
    }
  });
});

describe("the wiring", () => {
  /*
   * §9.7: the guard and the side pool are both correct and both useless if the
   * application still hands `AuditService` the request pool — that combination
   * turns a 22-hour hang into a 500 on every audited write, which is a
   * different outage rather than none.
   *
   * So this boots the real module graph and asserts the two pools are distinct
   * objects and that the request pool is the guarded one.
   */
  it("gives the app two distinct pools, and guards the request one", async () => {
    const app = await NestFactory.create(AppModule, { logger: false });

    try {
      const requestPool = app.get<Pool>(PG_POOL);
      const sidePool = app.get<Pool>(PG_SIDE_POOL);

      expect(sidePool).not.toBe(requestPool);

      // The guard is on the request pool: entering a `runInTenant` on it and
      // asking it for a second connection must be refused.
      await expect(
        runInTenant(requestPool, { customerId, role: "system" }, async () =>
          requestPool.query("SELECT 1"),
        ),
      ).rejects.toThrow(PoolReentryError);

      // And the side pool answers from inside that same context, which is the
      // whole point of it existing.
      await within(
        runInTenant(requestPool, { customerId, role: "system" }, async () => {
          await sidePool.query("SELECT 1");
        }),
      );
    } finally {
      await app.close();
    }
  });
});
