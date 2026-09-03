/**
 * Snapshot and restore the **development** database (P181-02).
 *
 *   pnpm db:snapshot [name]     dump the dev database to db/snapshots/<name>.dump
 *   pnpm db:restore  <name>     drop it, recreate it, and load that dump back
 *   pnpm db:snapshots           list what you have
 *
 * ## Why this is not the backup system
 *
 * `apps/api/src/backup` is the production one: encrypted with the deployment's
 * key, uploaded to object storage, pruned on a retention policy, verified for
 * freshness, and restorable with `dsc run --rm backup restore`. It is built
 * around the fact that the data is a hundred physicians' CME records.
 *
 * This one is built around the fact that the data is `Anna Mueller` and a
 * course called "DS Test Course". It is a `pg_dump` to a file in the
 * repository's own `db/snapshots/` — no encryption, no bucket, no retention.
 * Encrypting a developer's seed data would add a key to lose and protect
 * nothing.
 *
 * Keeping them separate is the point. The production tool must not grow a
 * "local mode" that skips encryption, because that flag would then exist on the
 * machine that holds real records.
 *
 * ## What it is for
 *
 * The moment before something destructive: a migration you are writing, a seed
 * you are changing, a bug you are reproducing by hand and will want to
 * reproduce again. `pnpm db:dev:reset` gets you back to *seeded*; this gets you
 * back to **the state you were in**, which is the one that took twenty minutes
 * of clicking to reach.
 *
 * ## Why `db/snapshots/` and not /tmp
 *
 * Because a snapshot you cannot find is a snapshot you did not take. It is
 * git-ignored — a dump of even a development database is a file nobody benefits
 * from committing.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOTS = join(REPO, "db", "snapshots");

const SUPERUSER =
  process.env["POSTGRES_SUPERUSER_URL"] ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const DB_NAME = process.env["DEV_DB_NAME"] ?? "ds_education";

const ESC = String.fromCharCode(27);
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RED = `${ESC}[1;31m`;
const GREEN = `${ESC}[1;32m`;
const OFF = `${ESC}[0m`;

/**
 * Whether the host has this client of its own.
 *
 * The same fallback `devdb.mjs` documents for `psql`, and for the same reason:
 * `postgresql-client` is not something Node, pnpm or Docker pull in, and a
 * developer with a running database container should not have to install a
 * database client to take a snapshot of it. When it is absent, the container's
 * own binary does the work — same version as the server, nothing to install.
 */
function hasHostBinary(name) {
  return spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0;
}

function compose(args, options = {}) {
  return spawnSync(
    "docker",
    ["compose", "-f", join(REPO, "infra", "docker-compose.yml"), ...args],
    { cwd: REPO, encoding: "utf8", ...options },
  );
}

function die(message) {
  console.error(`\n${RED}x${OFF} ${message}\n`);
  process.exit(1);
}

/** `postgres://user:pass@host:port/db` split into what libpq wants. */
function parts(url, database) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port || "5432",
    user: decodeURIComponent(parsed.username) || "postgres",
    password: decodeURIComponent(parsed.password),
    database,
  };
}

/** libpq's own variables, so no password reaches a command line (`ps`). */
function libpq(connection) {
  return {
    PGHOST: connection.host,
    PGPORT: connection.port,
    PGUSER: connection.user,
    PGPASSWORD: connection.password,
    PGDATABASE: connection.database,
  };
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  if (result.error !== undefined) {
    die(`${command} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) die(`${command} exited ${String(result.status)}`);
}

function containerId() {
  const id = compose(["ps", "-q", "postgres"]).stdout.trim();
  if (id === "") {
    die("the postgres container is not running. Start it with `pnpm infra:up`.");
  }
  return id;
}

function snapshotPath(name) {
  // The name is an argument and it becomes a filename: a slash or a `..` in it
  // would write outside `db/snapshots/`.
  if (!/^[A-Za-z0-9._-]+$/u.test(name)) {
    die(`"${name}" is not a usable name — letters, digits, dot, dash, underscore.`);
  }
  return join(SNAPSHOTS, `${name}.dump`);
}

/** Sorts chronologically, and says when without anybody having to name it. */
function defaultName() {
  return new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
}

function list() {
  const files = existsSync(SNAPSHOTS)
    ? readdirSync(SNAPSHOTS)
        .filter((file) => file.endsWith(".dump"))
        .map((file) => ({ file, stat: statSync(join(SNAPSHOTS, file)) }))
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    : [];

  if (files.length === 0) {
    console.log(`No snapshots yet. ${DIM}pnpm db:snapshot${OFF} takes one.`);
    return;
  }

  console.log(`${BOLD}Snapshots${OFF} ${DIM}db/snapshots/${OFF}\n`);
  for (const { file, stat } of files) {
    const mb = (stat.size / 1_048_576).toFixed(1);
    const name = file.replace(/\.dump$/u, "");
    console.log(
      `  ${name.padEnd(24)} ${mb.padStart(7)} MB   ${stat.mtime.toISOString()}`,
    );
  }
  console.log(`\n${DIM}pnpm db:restore <name>${OFF}`);
}

function snapshot(name) {
  mkdirSync(SNAPSHOTS, { recursive: true });
  const path = snapshotPath(name);
  const connection = parts(SUPERUSER, DB_NAME);

  console.log(`${BOLD}Snapshotting${OFF} ${DB_NAME} -> db/snapshots/${name}.dump`);

  if (hasHostBinary("pg_dump")) {
    run(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges", "--file", path],
      libpq(connection),
    );
  } else {
    /*
     * Through the container, writing inside it and copying out.
     *
     * `--file` with a host path would be a path the container cannot see — the
     * kind of difference between two code paths that only shows up on the
     * machine that takes the second one, which is why `devdb.mjs` pipes rather
     * than passing paths for the same reason.
     */
    const id = containerId();
    const inside = `/tmp/${name}.dump`;

    const dumped = compose(
      [
        "exec",
        "-T",
        "-e",
        `PGPASSWORD=${connection.password}`,
        "postgres",
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "-U",
        connection.user,
        "-d",
        connection.database,
        "-f",
        inside,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    if (dumped.status !== 0) die("pg_dump failed inside the postgres container");

    const copied = spawnSync("docker", ["cp", `${id}:${inside}`, path], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    compose(["exec", "-T", "postgres", "rm", "-f", inside]);
    if (copied.status !== 0) die("could not copy the dump out of the container");
  }

  const size = (statSync(path).size / 1_048_576).toFixed(1);
  console.log(`\n${GREEN}ok${OFF} ${size} MB  ${DIM}pnpm db:restore ${name}${OFF}\n`);
}

function restore(name) {
  const path = snapshotPath(name);
  if (!existsSync(path)) {
    die(
      `db/snapshots/${name}.dump does not exist. \`pnpm db:snapshots\` lists what does.`,
    );
  }

  const connection = parts(SUPERUSER, DB_NAME);

  /*
   * Dropped and recreated, not restored over.
   *
   * `pg_restore` into a database that already holds these tables produces a
   * wall of "already exists" and a half-applied result, and the one thing this
   * command exists to give is a *known* state.
   *
   * Safe here and refused by the production tool for the opposite reason: this
   * only ever touches `DEV_DB_NAME` (default `ds_education`) on whatever
   * `POSTGRES_SUPERUSER_URL` points at, which for a developer is a container on
   * their own machine.
   */
  console.log(`${BOLD}Restoring${OFF} db/snapshots/${name}.dump -> ${DB_NAME}`);
  console.log(`${DIM}Dropping and recreating ${DB_NAME} first.${OFF}\n`);

  const admin = parts(SUPERUSER, "postgres");
  psqlAdmin(admin, `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  psqlAdmin(admin, `CREATE DATABASE ${DB_NAME}`);

  if (hasHostBinary("pg_restore")) {
    run(
      "pg_restore",
      ["--no-owner", "--no-privileges", "--dbname", DB_NAME, path],
      libpq(connection),
    );
  } else {
    const id = containerId();
    const inside = `/tmp/${name}.restore.dump`;

    const copied = spawnSync("docker", ["cp", path, `${id}:${inside}`], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (copied.status !== 0) die("could not copy the dump into the container");

    const restored = compose(
      [
        "exec",
        "-T",
        "-e",
        `PGPASSWORD=${connection.password}`,
        "postgres",
        "pg_restore",
        "--no-owner",
        "--no-privileges",
        "-U",
        connection.user,
        "-d",
        connection.database,
        inside,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    compose(["exec", "-T", "postgres", "rm", "-f", inside]);
    if (restored.status !== 0) die("pg_restore failed inside the postgres container");
  }

  console.log(`\n${GREEN}ok${OFF} ${DB_NAME} is that snapshot again.\n`);
}

function psqlAdmin(connection, sql) {
  if (hasHostBinary("psql")) {
    run(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", "-c", sql],
      libpq(connection),
    );
    return;
  }

  const result = compose(
    [
      "exec",
      "-T",
      "-e",
      `PGPASSWORD=${connection.password}`,
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-U",
      connection.user,
      "-d",
      connection.database,
      "-c",
      sql,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (result.status !== 0) die(`psql failed: ${sql}`);
}

const command = process.argv[2] ?? "";

switch (command) {
  case "snapshot":
    snapshot(process.argv[3] ?? defaultName());
    break;
  case "restore":
    if (process.argv[3] === undefined) {
      die("which snapshot? `pnpm db:snapshots` lists them.");
    }
    restore(process.argv[3]);
    break;
  case "list":
    list();
    break;
  default:
    console.error(
      "usage:\n" +
        "  pnpm db:snapshot [name]   dump the development database\n" +
        "  pnpm db:restore  <name>   drop it, recreate it, load that dump\n" +
        "  pnpm db:snapshots         list what you have\n",
    );
    process.exit(1);
}
