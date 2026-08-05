/**
 * Create the platform's first super administrator (P14-01).
 *
 * ## Why this exists
 *
 * A freshly deployed platform has an empty `admin_users` table, and every way
 * into the console requires a row in it. Staff accounts are created by
 * invitation, invitations are issued by an account that may invite, and there
 * is no such account yet. That is a correct design with exactly one hole in it,
 * and this file is the hole.
 *
 * It runs **once**, from the host, as part of the first deploy:
 *
 *   docker compose run --rm --entrypoint node api dist/bootstrap-admin.js \
 *     --email technik@digitalspital.de --name "Technik"
 *
 * ## Why it refuses to run twice
 *
 * With any staff account in the table, the ordinary paths work: invite, reset,
 * disable. A bootstrap that stayed available would be a second way to mint a
 * super administrator, reachable by anyone who can start a container on the
 * host — which, over the life of a system, is more people than the ones who
 * should hold that role. `--force` exists for the genuine lockout, and says so
 * in the audit log.
 *
 * ## Why the password is generated rather than supplied
 *
 * A password passed as an argument is in the shell history, in the process
 * list and in whatever recorded the SSH session. This one is generated from
 * `randomBytes`, printed once, and never stored in plaintext anywhere — the
 * row holds an Argon2id hash and nothing else.
 *
 * The account still owes a second factor: `super_admin` requires TOTP, and the
 * first sign-in goes to enrolment rather than being refused (P12-01). So the
 * printed password alone does not grant access to anyone who reads it later
 * out of a terminal scrollback.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "./modules/staff/credentials.js";

/* eslint-disable no-console -- this is a CLI; its output is the point. */

interface Options {
  readonly email: string;
  readonly displayName: string;
  readonly force: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let email = "";
  let displayName = "";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--email" && value !== undefined) {
      email = value;
      index += 1;
    } else if (flag === "--name" && value !== undefined) {
      displayName = value;
      index += 1;
    } else if (flag === "--force") {
      force = true;
    } else {
      throw new Error(`unexpected argument: ${String(flag)}`);
    }
  }

  if (email === "") throw new Error("--email is required");
  // Not a full address grammar — that argument is unwinnable and this is a
  // CLI a human runs once. It catches the transposed flag, which is the real
  // failure: `--email "Technik" --name tech@…`.
  if (!email.includes("@"))
    throw new Error(`--email does not look like an address: ${email}`);

  return { email, displayName: displayName === "" ? email : displayName, force };
}

/**
 * A password a human has to type once, on a phone-free laptop, without
 * mistaking a 1 for an l.
 *
 * Six groups of five from an unambiguous alphabet: 30 characters drawn from
 * 31 symbols is a little under 150 bits, which is far past anything an
 * offline attack on an Argon2id hash would reach. `randomBytes` with a
 * rejection-free modulo is acceptable here only because the alphabet's length
 * is not a power of two but the bias at 256/31 is ~1.6 % on three symbols —
 * so the loop rejects out-of-range bytes rather than folding them.
 */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length);
  const out: string[] = [];

  while (out.length < 30) {
    for (const byte of randomBytes(64)) {
      if (out.length === 30) break;
      // Rejected rather than folded: `byte % 31` on the tail of the range
      // would make three letters measurably likelier than the rest.
      if (byte >= limit) continue;
      out.push(alphabet[byte % alphabet.length] ?? "a");
    }
  }

  return (out.join("").match(/.{5}/gu) ?? []).join("-");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({ connectionString });

  try {
    const { rows: existing } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM admin_users",
    );
    const accounts = Number(existing[0]?.count ?? "0");

    if (accounts > 0 && !options.force) {
      throw new Error(
        `refusing: ${accounts} staff account(s) already exist. Use the console's ` +
          "invitation flow, or --force if you are locked out.",
      );
    }

    const { rows: clash } = await pool.query<{ id: string }>(
      "SELECT id FROM admin_users WHERE lower(email) = lower($1)",
      [options.email],
    );
    if (clash.length > 0) {
      throw new Error(`refusing: an account already exists for ${options.email}`);
    }

    const password = generatePassword();
    const passwordHash = await hashPassword(password);
    const id = randomUUID();

    // One transaction: an account with no role is an account that can sign in
    // and do nothing, and it would have to be found and repaired by hand.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO admin_users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
        [id, options.email, options.displayName, passwordHash],
      );
      // `customer_id` is null: a super administrator spans every customer, and
      // `admin_user_roles_scope_matches_role` requires exactly that.
      await client.query(
        "INSERT INTO admin_user_roles (admin_user_id, role, customer_id) VALUES ($1, 'super_admin', NULL)",
        [id],
      );
      // Append-only for `ds_app` (migration 0017), which is the point: the
      // creation of the account that can do everything is the one event that
      // must not be removable by the account it creates.
      await client.query(
        `INSERT INTO admin_audit_log (actor_id, actor_email, action, subject_id, detail)
         VALUES ($1, $2, 'staff.bootstrap', $1, $3)`,
        [
          id,
          options.email,
          JSON.stringify({ forced: options.force, priorAccounts: accounts }),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log("");
    console.log("  Super administrator created.");
    console.log("");
    console.log(`    E-Mail    ${options.email}`);
    console.log(`    Passwort  ${password}`);
    console.log("");
    console.log("  This password is shown once and is stored nowhere. Sign in now;");
    console.log("  the first sign-in enrols the second factor, which super_admin");
    console.log("  requires. Change the password from the console afterwards.");
    console.log("");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string carries a password; never echo the whole error object.
  console.error(
    "Bootstrap failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
