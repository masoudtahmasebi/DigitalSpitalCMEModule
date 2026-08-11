/**
 * The MEDICE ADHS course, from inside the API image (P24-02).
 *
 * `db/seed/adhs.ts` is the developer-facing runner and needs `tsx`, the
 * workspace and the repository checkout. None of those exist on the production
 * host, where the only artefact is a container — which is why the first
 * customer's course could not be seeded on the server at all, and why
 * `fortbildung.digitalspital.com/medice` was empty.
 *
 * It does not carry its own copy of the seed. See `db-migrate.ts` for what
 * happened the one time this repository had two copies of something like this.
 *
 *   ./dsc run --rm --entrypoint node api dist/seed-medice.js
 */

import { openSeedPool, seedMediceAdhs } from "@ds/seed";
import { assertSchemaCurrent, migrationDatabaseUrl } from "./schema-freshness.js";

async function main(): Promise<void> {
  await assertSchemaCurrent(migrationDatabaseUrl());
  const pool = openSeedPool("the MEDICE ADHS course");
  try {
    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    console.log(await seedMediceAdhs(pool));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Seeding the MEDICE course failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
