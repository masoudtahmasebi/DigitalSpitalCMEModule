/**
 * Console operators for a seeded tenant (P38-01).
 *
 * ## Why this was missing, and what it cost
 *
 * Three seeds populated a tenant down to its quiz options, and none of them
 * created an account that could *open* the console for it. The only staff
 * account any installation had was the one `bootstrap-admin` mints — a
 * `super_admin`, whose password is printed once and never again.
 *
 * So "log in to Verwaltung and look at the demo tenant" meant signing in as the
 * account that can do everything to every customer, which is the wrong account
 * to hand anybody for a look around, and it left the two roles that actually
 * matter to this client — the one who may build an organisation and the one who
 * may only write courses — with no way to be seen at all.
 *
 * ## Two accounts, because the client asked for two roles
 *
 * | Account       | Role             | May                                                       |
 * | ------------- | ---------------- | --------------------------------------------------------- |
 * | `verwaltung@` | `customer_admin` | departments, projects, courses, participants, branding    |
 * | `redaktion@`  | `course_editor`  | courses and their content — nothing above a course        |
 *
 * The difference is enforced by the API, not by the navigation: a
 * `course_editor` who calls `POST /admin/departments` gets a 403 whether or not
 * the console drew the button. That is what makes these two accounts worth
 * seeding — they are the only way to *look* at a rule that is otherwise only
 * visible in an authorization test.
 *
 * ## Why the addresses end in `.example`
 *
 * RFC 2606 reserves it, so none of these can ever be a deliverable inbox. A
 * demo account on a real domain is a demo account somebody eventually sends a
 * password reset to.
 *
 * ## What these accounts are not
 *
 * **Not exempt from anything.** The platform's second-factor policy is
 * `required` (ADR-0012) and these accounts hold no factor, so the first sign-in
 * goes to enrolment exactly as the super administrator's does. Seeding a factor
 * would mean seeding a shared TOTP secret, which is a credential in the
 * repository — the thing the whole design refuses.
 *
 * **Not for production, unflagged.** They are listed in `docs/mock-data.md` as
 * mock data with an owner and a replacement, because an installation that
 * reaches a customer with `verwaltung@dscustomer.example` still able to sign in
 * has a staff account nobody chose.
 */

import type pg from "pg";
import { seededPassword, type SeededPassword } from "./lib.js";

/** The roles this seed creates, in the order the report prints them. */
const ROLES = ["customer_admin", "course_editor"] as const;

export type DemoStaffRole = (typeof ROLES)[number];

export interface DemoStaffAccount {
  readonly email: string;
  readonly displayName: string;
  readonly role: DemoStaffRole;
  /** Absent when the caller asked not to be told — see `revealPasswords`. */
  readonly password?: string;
}

export interface DemoStaffOptions {
  readonly customerId: string;
  /** Lower-case; the addresses are derived from it. */
  readonly customerSlug: string;
  /**
   * Whether the returned accounts may carry their plaintext passwords.
   *
   * False for anything unattended, on `seedDsDefault`'s reasoning: the deploy
   * runs over SSH from a GitHub Actions job, so a returned password is written
   * to a workflow log that outlives every rotation.
   */
  readonly revealPasswords?: boolean;
}

/**
 * One password per account, never a shared one.
 *
 * A single seeded password across two roles would make the two accounts
 * interchangeable to anybody holding it, which is the opposite of what seeding
 * two roles is for. `SEED_STAFF_PASSWORD` overrides — for a demo installation
 * somebody has to hand round, and it is why the report says where the password
 * came from rather than only what it is.
 */
async function staffPassword(): Promise<SeededPassword> {
  return seededPassword(process.env["SEED_STAFF_PASSWORD"]);
}

/**
 * Create — or repair — the two console accounts for one customer.
 *
 * Idempotent on the address, like every other seed here is on its slugs. A
 * re-run rewrites the password, which is deliberate: the report is the only
 * place the password ever exists, so a re-run has to be able to produce a
 * usable one rather than print a value the row no longer matches.
 *
 * ## Why `admin_users` is written outside the tenant context
 *
 * Staff accounts sit **above** any customer — the same reason the console has
 * two API clients, and the reason `admin_users` carries no `customer_id`. The
 * *grant* is what names the customer, and it is the grant that RLS scopes. A
 * caller that has already entered a tenant is fine; this writes no tenant-scoped
 * row that the context could contradict.
 */
export async function seedDemoStaff(
  pool: pg.Pool,
  options: DemoStaffOptions,
): Promise<DemoStaffAccount[]> {
  const reveal = options.revealPasswords ?? true;
  const created: DemoStaffAccount[] = [];

  for (const role of ROLES) {
    const local = role === "customer_admin" ? "verwaltung" : "redaktion";
    const email = `${local}@${options.customerSlug}.example`;
    const displayName =
      role === "customer_admin"
        ? `${options.customerSlug} · Verwaltung (Demo)`
        : `${options.customerSlug} · Redaktion (Demo)`;

    const password = await staffPassword();

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, display_name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO UPDATE SET
         display_name  = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         -- A re-seed must not resurrect an account somebody disabled on
         -- purpose, and must not leave a locked-out demo account unusable
         -- either. Clearing the counters is safe; clearing disabled_at is not,
         -- so it is left exactly as an operator set it.
         failed_attempts = 0,
         last_failure_at = NULL,
         updated_at    = now()
       RETURNING id`,
      [email, displayName, password.hash],
    );

    const adminUserId = rows[0]?.id;
    if (adminUserId === undefined) {
      throw new Error(`could not create the demo staff account ${email}`);
    }

    /*
     * The grant, and only this one.
     *
     * `admin_user_roles_scope_matches_role` requires `customer_id` for both of
     * these roles and forbids a `department_id` on `customer_admin`, so there
     * is exactly one shape each. Old grants for this account are removed first:
     * a re-seed that left a stale `super_admin` row behind would be a demo
     * account that quietly outranks its own description.
     */
    await pool.query("DELETE FROM admin_user_roles WHERE admin_user_id = $1", [
      adminUserId,
    ]);
    await pool.query(
      `INSERT INTO admin_user_roles (admin_user_id, role, customer_id)
       VALUES ($1, $2, $3)`,
      [adminUserId, role, options.customerId],
    );

    created.push({
      email,
      displayName,
      role,
      ...(reveal ? { password: password.plaintext } : {}),
    });
  }

  return created;
}

/** The block a seed's report prints for the accounts it created. */
export function describeDemoStaff(accounts: readonly DemoStaffAccount[]): string[] {
  const lines = ["Console sign-in (Verwaltung) — demo accounts, see docs/mock-data.md:"];

  for (const account of accounts) {
    lines.push(`  ${account.role}`);
    lines.push(`    E-Mail    ${account.email}`);
    lines.push(
      account.password === undefined
        ? "    Passwort  generated and deliberately not printed — this run was unattended."
        : `    Passwort  ${account.password}`,
    );
  }

  lines.push(
    "",
    "  Both owe a second factor: the platform policy is `required`, so the",
    "  first sign-in goes to enrolment. Nothing here is exempt from it.",
  );

  return lines;
}
