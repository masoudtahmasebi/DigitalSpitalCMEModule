/**
 * The developer-facing runner for the MEDICE ADHS course (P24-02).
 *
 * The seed itself is `@ds/seed`, not here: it also has to run on the
 * production host, where there is no `tsx`, no workspace and no checkout —
 * only the API image. This file and `apps/api/src/seed-medice.ts` are two
 * `main()`s over one implementation, for exactly the reason
 * `apps/api/src/db-migrate.ts` gives about the migration algorithm.
 *
 *   pnpm db:seed
 */

import { openSeedPool, seedMediceAdhs } from "@ds/seed";

const pool = openSeedPool("the MEDICE ADHS course");

try {
  console.warn(await seedMediceAdhs(pool));
} finally {
  await pool.end();
}
