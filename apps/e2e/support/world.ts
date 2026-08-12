/**
 * The database this suite drives a browser against (P35-01).
 *
 * Its own database, for the reason P32 spent a phase on: a suite that shares
 * one with development has no defined starting state, and every assertion
 * silently encodes whatever was there that day. `ds_education_e2e` is created,
 * migrated and seeded here and belongs to nothing else.
 *
 * The seed is `@ds/seed`'s DS demo tenant — the same code the deploy runs — so
 * what the browser sees is what a real installation has, not a fixture written
 * to make a test pass.
 */

import { spawnSync } from "node:child_process";
import { Pool } from "pg";

export const DB_NAME = "ds_education_e2e";

/**
 * Deterministic, so the sign-in step can type it.
 *
 * The seed generates one from the CSPRNG when this is unset, which is right for
 * a real installation and useless to a test that has to log in. Self-describing
 * rather than realistic — P33-02 is the record of what realistic-looking
 * fixtures cost.
 */
export const PARTICIPANT_PASSWORD = "e2e-participant-password";

/** Matches `packages/seed/src/ds-demo.ts`. */
export const TENANT = "ds";
export const COURSE_WITH_POINTS = "ds-cme-demo";

/** The titles those slugs carry, so a spec can look for what a physician reads. */
export const COURSE_WITH_POINTS_TITLE = "DS Demo – Fortbildung mit CME-Punkten";
export const COURSE_WITHOUT_POINTS_TITLE = "DS Demo – Fortbildung ohne Punkte";
export const COURSE_WITHOUT_POINTS = "ds-ohne-punkte";
export const PARTICIPANT_EMAIL = "demo@ds.example";

/**
 * The tenant's own console operators, seeded alongside it (P38-01).
 *
 * Deterministic for the same reason the participant's password is: a suite that
 * cannot type the password cannot open the screen. One password across both
 * accounts is acceptable *here* and nowhere else — the two are distinguished by
 * their grant, which is the thing under test, and this database exists for
 * ninety seconds.
 */
export const STAFF_PASSWORD = "e2e-staff-password";
export const CUSTOMER_ADMIN_EMAIL = "verwaltung@ds.example";
export const COURSE_EDITOR_EMAIL = "redaktion@ds.example";

export const EFN = "123456789012345";

/**
 * The DS Test tenant, which the journey suite authors inside (P68-01).
 *
 * Its operator is a `customer_admin`, not a super administrator, and the values
 * here are the seed's own defaults — the same account that exists on the
 * deployed installation, so `journey.spec.ts` runs unchanged against both.
 * `support/target.ts` is where the two are chosen between.
 */
export const DS_TEST_TENANT = "dstest";
export const DS_TEST_STAFF_EMAIL = "e2e@dstest.example";
export const DS_TEST_STAFF_PASSWORD = "ds-test-operator-2026";

/** 32 bytes, padded rather than pasted — see the journey suite for why. */
export const KMS_KEY = Buffer.alloc(32, "ds-e2e-kms-key-not-a-secret").toString("base64");

function psql(url: string, args: readonly string[]): void {
  const result = spawnSync(
    "psql",
    [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", ...args],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr ?? ""}`);
  }
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result.stdout ?? "";
}

export interface Prepared {
  readonly databaseUrl: string;
  readonly migrationUrl: string;
  readonly superuserUrl: string;
}

/** Drop, create, migrate and seed. Cheap enough to do before every run. */
export function prepareDatabase(repo: string, superuser: string): Prepared {
  const { host, hostname } = new URL(superuser);

  /*
   * Loopback only, and on the *hostname* rather than on host-and-port.
   *
   * The guard exists because this function begins with `DROP DATABASE`, and a
   * `POSTGRES_SUPERUSER_URL` pointed at a shared cluster would be a very short
   * incident. What it must not also do is decide which **port** a developer's
   * Postgres listens on: this rig runs one on 5433 alongside the system's, and
   * the first version of this check refused it with a message about "local
   * clusters" while looking at a cluster that could not be more local.
   *
   * A narrower guard that refuses a legitimate setup gets widened by whoever
   * hits it, usually by deleting it. Checking the thing it is actually about
   * keeps it.
   */
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
    throw new Error(`refusing to rebuild a database on ${host}: loopback clusters only`);
  }

  psql(superuser, [
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`,
  ]);
  psql(superuser, ["-c", `DROP DATABASE IF EXISTS ${DB_NAME}`]);
  psql(superuser, ["-c", `CREATE DATABASE ${DB_NAME}`]);

  const target = new URL(superuser);
  target.pathname = `/${DB_NAME}`;
  psql(target.toString(), ["-f", `${repo}/infra/postgres/init-roles.sql`]);

  const databaseUrl = `postgres://ds_app:ds_app_dev@${target.host}/${DB_NAME}`;
  const migrationUrl = `postgres://ds_migrator:ds_migrator_dev@${target.host}/${DB_NAME}`;

  run("pnpm", ["db:migrate"], repo, {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
  });
  run("pnpm", ["db:seed:ds"], repo, {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
    SEED_PARTICIPANT_PASSWORD: PARTICIPANT_PASSWORD,
    SEED_STAFF_PASSWORD: STAFF_PASSWORD,
  });

  // The tenant the journey suite writes into. Seeded by the same command the
  // deploy runs, so what the browser drives here is what exists there.
  run("pnpm", ["db:seed:ds-test"], repo, {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
    SEED_TEST_STAFF_PASSWORD: DS_TEST_STAFF_PASSWORD,
  });

  return { databaseUrl, migrationUrl, superuserUrl: target.toString() };
}

/**
 * Give the seeded course an accreditation, so the certificate carries points.
 *
 * The DS demo tenant is deliberately shipped with a dummy VNR and a fictional
 * Ärztekammer so nothing it seeds can reach EIV. That is right for a demo and
 * leaves one thing untested here: the Zertifizierung a physician actually
 * receives. Setting it through SQL rather than the console keeps this in the
 * harness where it belongs — the console's own path is covered by the journey
 * suite's act 7.
 */
export async function accreditSeededCourse(superuserUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: superuserUrl });
  try {
    await pool.query(
      `UPDATE courses
          SET scientific_lead_name = 'Dr. E2E',
              certificate_issue_place = 'Münster',
              stamp_image = $2, stamp_image_mime = 'image/png',
              signature_image = $2, signature_image_mime = 'image/png'
        WHERE slug = $1`,
      [COURSE_WITH_POINTS, Buffer.from(PLACEHOLDER_PNG, "base64")],
    );
  } finally {
    await pool.end();
  }
}

/** 1×1 PNG — real enough for the magic-byte check the upload path applies. */
const PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Forget that this browser has signed in five times in the last minute.
 *
 * `participantSignIn` allows five attempts per IP per minute, and it is a real
 * control: "stops an online guessing run" is one of the things this platform is
 * for. Every test here arrives from 127.0.0.1, so a suite with more than five
 * sign-ins starts failing on the sixth — not because anything is broken, but
 * because the limiter is working.
 *
 * The choice is to fight the control or to reset it. Resetting is the honest
 * one: the limiter has its own coverage in the API suites, where the assertion
 * is that it *does* refuse, and a browser test that has to keep its sign-in
 * count under five to stay green is a test that will be quietly deleted the
 * first time somebody adds a sixth.
 */
export async function forgetSignInAttempts(): Promise<void> {
  const url = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";
  const { hostname, port } = new URL(url);

  const { createConnection } = await import("node:net");
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(
      { host: hostname, port: Number(port || 6379) },
      () => {
        // Inline Lua, because a wildcard DEL is not a single Redis command and
        // pulling in a client library for one call is not worth the dependency.
        const script =
          "for _,k in ipairs(redis.call('keys', ARGV[1])) do redis.call('del', k) end";
        const command = ["EVAL", script, "0", "ratelimit:participantSignIn:*"];
        const encoded =
          `*${command.length}\r\n` +
          command.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("");
        socket.write(encoded);
      },
    );

    socket.once("data", () => {
      socket.end();
      resolve();
    });
    socket.once("error", reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error("Redis did not answer the rate-limit reset"));
    });
  });
}
