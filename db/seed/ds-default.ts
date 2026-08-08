/**
 * The developer-facing runner for the default DS customer (P26-01).
 *
 * The seed itself is `@ds/seed`, not here: it also has to run on the
 * production host, where there is no `tsx`, no workspace and no checkout —
 * only the API image. This file and `apps/api/src/seed-ds-default.ts` are two
 * `main()`s over one implementation, for exactly the reason
 * `apps/api/src/db-migrate.ts` gives about the migration algorithm.
 *
 * Attended, so the generated participant password is printed: a developer who
 * ran this is looking at the terminal it came out of.
 *
 *   pnpm db:seed:default
 */

import { openSeedPool, seedDsDefault } from "@ds/seed";

const pool = openSeedPool("the default DS customer");

try {
  console.warn(await seedDsDefault(pool));
} finally {
  await pool.end();
}
