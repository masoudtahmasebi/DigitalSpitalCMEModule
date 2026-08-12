/**
 * The DS Test tenant — the one the end-to-end suite drives (P68-01).
 *
 * ## Why a tenant of its own, when `ds` already exists
 *
 * `ds` is the demo: it is what somebody is shown, and its content is stable on
 * purpose. A suite that drives a browser through *authoring* has to create
 * courses, upload files and publish things, and doing that inside the demo
 * tenant means the demo is whatever the last test run left behind.
 *
 * So this tenant exists to be written to. Its data is expected to accumulate —
 * the client asked for exactly that — and every run names its objects with a
 * fresh suffix, so runs never collide and an old run's course is still there to
 * look at when something goes wrong.
 *
 * ## What it seeds, and what it deliberately does not
 *
 * A customer, a department, a portal project, and **one operator who can do
 * everything**. Nothing else.
 *
 * No course. That is the point: course creation, the video, the quiz and the
 * publish are what the suite is there to exercise, and a seeded course would
 * mean the suite asserts against a fixture rather than against the thing an
 * operator actually builds. Every defect this suite exists to catch lives in
 * the authoring path, not in a row somebody inserted.
 *
 * ## Why the operator's password is deterministic
 *
 * A suite has to sign in. `SEED_TEST_STAFF_PASSWORD` overrides it; the default
 * is self-describing rather than realistic, because P33-02 is the record of
 * what realistic-looking fixtures cost when somebody mistakes one for a
 * credential.
 *
 * This tenant carries **no accreditation and no CME points on anything seeded**,
 * so nothing here can reach EIV-FOBI even before ADR-0005's guard.
 */

import type pg from "pg";
import {
  enterTenant,
  resolveCustomerId,
  seededPassword,
  seedPortalProject,
  upsert,
} from "./lib.js";

/**
 * Fixed, for the same reason MEDICE's is: `customers`' own RLS policy checks
 * `id = app.customer_id`, so the id has to be known before the insert that
 * creates the row. Ends `…004`, after `ds` (…002) and the default (…003).
 */
const CUSTOMER_ID = "0198f4c1-7a2e-7000-8000-000000000004";
const CUSTOMER_SLUG = "dstest";
const CUSTOMER_NAME = "DS Test (automatisierte Tests)";

/** The portal path: `fortbildung.…/dstest`. */
const PORTAL_PROJECT_SLUG = CUSTOMER_SLUG;

const STAFF_EMAIL = "e2e@dstest.example";

export interface DsTestCredentials {
  readonly customerId: string;
  readonly staffEmail: string;
  readonly staffPassword: string;
  readonly tenantPath: string;
}

/**
 * Seed the tenant and return what the suite needs to sign in.
 *
 * Returns a value rather than a printed report, unlike its siblings: the caller
 * here is a test harness, not an operator reading stdout. `describeDsTest`
 * turns it into the human summary when a person runs it by hand.
 */
export async function seedDsTest(pool: pg.Pool): Promise<DsTestCredentials> {
  const password = process.env["SEED_TEST_STAFF_PASSWORD"] ?? "ds-test-operator-2026";

  try {
    await pool.query("BEGIN");

    const tenantId = await resolveCustomerId(pool, {
      id: CUSTOMER_ID,
      slug: CUSTOMER_SLUG,
    });
    await enterTenant(pool, tenantId);

    const customerId = await upsert(
      pool,
      `INSERT INTO customers (id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name,
                                      updated_at = now()
       RETURNING id`,
      [tenantId, CUSTOMER_SLUG, CUSTOMER_NAME],
    );

    const departmentId = await upsert(
      pool,
      `INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3)
       ON CONFLICT (customer_id, slug) DO UPDATE SET name = EXCLUDED.name,
                                                    updated_at = now()
       RETURNING id`,
      [customerId, "default", "Testabteilung"],
    );

    await seedPortalProject(pool, {
      customerId,
      departmentId,
      slug: PORTAL_PROJECT_SLUG,
      name: "DS Test (Portal)",
    });

    /*
     * One operator, `customer_admin`, with a password.
     *
     * Not `super_admin`: the suite should exercise the role a real customer's
     * administrator holds, because that is the role whose refusals are easy to
     * get wrong. Anything the suite cannot do as a `customer_admin` is a
     * finding, not a reason to widen the account.
     *
     * This seed takes no `--if-missing`, unlike its siblings, and does not need
     * one: it creates nothing destructible. There is no course, so there is no
     * `resetCourseContent` and no learner progress to lose. The password *is*
     * rewritten on every run, deliberately — an operator whose password the
     * suite cannot predict is an operator the suite cannot sign in as.
     */
    const credential = await seededPassword(password);
    const staffId = await upsert(
      pool,
      `INSERT INTO admin_users (email, display_name, password_hash)
       VALUES ($1,$2,$3)
       ON CONFLICT (lower(email)) DO UPDATE SET display_name = EXCLUDED.display_name,
                                                password_hash = EXCLUDED.password_hash,
                                                disabled_at = NULL,
                                                updated_at = now()
       RETURNING id`,
      [STAFF_EMAIL, "DS Test · Automatisierung", credential.hash],
    );

    await pool.query(
      `INSERT INTO admin_user_roles (admin_user_id, role, customer_id)
       SELECT $1,'customer_admin',$2
        WHERE NOT EXISTS (
          SELECT 1 FROM admin_user_roles
           WHERE admin_user_id = $1 AND role = 'customer_admin'
             AND customer_id = $2 AND department_id IS NULL)`,
      [staffId, customerId],
    );

    await pool.query("COMMIT");

    return {
      customerId,
      staffEmail: STAFF_EMAIL,
      staffPassword: password,
      tenantPath: PORTAL_PROJECT_SLUG,
    };
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** The summary a person running this by hand reads. */
export function describeDsTest(seeded: DsTestCredentials, reveal: boolean): string {
  return [
    "Seeded the DS Test tenant.",
    `  customer  ${CUSTOMER_SLUG}   (${CUSTOMER_NAME})`,
    `  portal    /${seeded.tenantPath}`,
    "",
    "Console sign-in for the automated suite:",
    `  E-Mail    ${seeded.staffEmail}`,
    reveal
      ? `  Passwort  ${seeded.staffPassword}`
      : "  Passwort  as supplied in SEED_TEST_STAFF_PASSWORD",
    "",
    "This tenant exists to be written to. The end-to-end suite creates a course,",
    "a video, a quiz and a participant on every run, each with a fresh suffix, so",
    "runs never collide and an old run's data is still there to look at.",
    "",
    "It carries no accreditation and no CME points on anything seeded, so nothing",
    "here can reach EIV-FOBI even before the deploy's own guard (ADR-0005).",
  ].join("\n");
}
