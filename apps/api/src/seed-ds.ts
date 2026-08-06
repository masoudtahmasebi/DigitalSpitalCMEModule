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

async function main(): Promise<void> {
  const pool = openSeedPool("the DS test tenant");
  try {
    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    console.log(await seedDsDemo(pool));
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
