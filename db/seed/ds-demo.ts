/**
 * The developer-facing runner for the DS test tenant (P20-01).
 *
 * The seed itself is `@ds/seed`, not here: it also has to run on the
 * production host, where there is no `tsx`, no workspace and no checkout —
 * only the API image. This file and `apps/api/src/seed-ds.ts` are two
 * `main()`s over one implementation, for exactly the reason
 * `apps/api/src/db-migrate.ts` gives about the migration algorithm.
 *
 *   pnpm db:seed:ds
 */

import { openSeedPool, seedDsDemo } from "@ds/seed";

const pool = openSeedPool("the DS test tenant");

try {
  console.warn(await seedDsDemo(pool));
} finally {
  await pool.end();
}
