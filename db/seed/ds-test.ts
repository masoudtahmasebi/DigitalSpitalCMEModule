/**
 * The developer-facing runner for the DS Test tenant (P68-01).
 *
 * The seed itself is `@ds/seed`, not here: it also has to run on the production
 * host, where there is no `tsx`, no workspace and no checkout — only the API
 * image. This file and `apps/api/src/seed-ds-test.ts` are two `main()`s over
 * one implementation, for the reason `apps/api/src/db-migrate.ts` gives about
 * the migration algorithm.
 *
 *   pnpm db:seed:ds-test
 */

import { describeDsTest, openSeedPool, seedDsTest } from "@ds/seed";

const pool = openSeedPool("the DS Test tenant");

try {
  // Revealed here and not in the image's runner: this one is invoked by a
  // person at a checkout, who is the only audience that can act on it.
  console.warn(describeDsTest(await seedDsTest(pool), true));
} finally {
  await pool.end();
}
