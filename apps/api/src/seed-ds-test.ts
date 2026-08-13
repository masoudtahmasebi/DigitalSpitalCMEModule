/**
 * The DS Test tenant, from inside the API image (P68-01).
 *
 * The tenant the end-to-end suite drives. It exists so that a suite which
 * *authors* — creating courses, uploading video, publishing — has somewhere to
 * write that is not the demo tenant somebody is being shown.
 *
 * Creates a customer, a department, a portal project and one `customer_admin`
 * with a predictable password. No course: building one is what the suite is for.
 *
 *   ./dsc run --rm --entrypoint node api dist/seed-ds-test.js
 */

import { describeDsTest, openSeedPool, seedDsTest } from "@ds/seed";
import { assertSchemaCurrent, migrationDatabaseUrl } from "./schema-freshness.js";

async function main(): Promise<void> {
  /*
   * `--if-missing` here means only "do not print the password".
   *
   * The unattended caller is `deploy.sh`, whose stdout is a GitHub Actions log,
   * and a usable console password in a build log is a credential that outlives
   * every rotation. The rows themselves are written either way — this seed
   * creates nothing destructible, so there is no re-run to protect against.
   */
  const unattended = process.argv.includes("--if-missing");
  await assertSchemaCurrent(migrationDatabaseUrl());
  const pool = openSeedPool("the DS Test tenant");
  try {
    const seeded = await seedDsTest(pool);
    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    console.log(describeDsTest(seeded, !unattended));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Seeding the DS Test tenant failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
