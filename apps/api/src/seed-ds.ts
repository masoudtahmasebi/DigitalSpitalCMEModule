/**
 * The DS test tenant, from inside the API image (P20-01).
 *
 * `db/seed/ds-demo.ts` is the developer-facing runner and needs `tsx`, the
 * workspace and the repository checkout. None of those exist on the production
 * host, where the only artefact is a container — so the image carries its own
 * entrypoint over the same implementation.
 *
 * It does not carry its own copy of the seed. See `db-migrate.ts` for what
 * happened the one time this repository had two copies of something like this.
 *
 *   ./dsc run --rm --entrypoint node api dist/seed-ds.js --force
 */

import { openSeedPool, seedDsDemo } from "@ds/seed";
import { assertSchemaCurrent, migrationDatabaseUrl } from "./schema-freshness.js";

async function main(): Promise<void> {
  /*
   * `--if-missing` — the flag that lets a deploy run this (P65-01).
   *
   * Without it the seed rebuilds the course's content tree unconditionally,
   * which deletes every learner's progress against it. With it, it reads one
   * row and returns before its first write once the tenant exists.
   *
   * That is what makes it safe on every deploy, and it is the fix for a failure
   * reported three times: `/medice` answering `{"kind":"unknown"}` on a host
   * where this seed existed in the repository and had never been run. A seed the
   * deploy cannot run is a seed somebody has to remember (CLAUDE.md §9.9).
   *
   * It also suppresses the generated participant password, because an
   * unattended run's stdout is a GitHub Actions log.
   */
  const ifMissing = process.argv.includes("--if-missing");
  await assertSchemaCurrent(migrationDatabaseUrl());
  const pool = openSeedPool("the DS test tenant");
  try {
    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    console.log(
      await seedDsDemo(pool, { onlyIfMissing: ifMissing, revealPassword: !ifMissing }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Seeding the DS tenant failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
