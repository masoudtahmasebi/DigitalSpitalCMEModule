/**
 * The default DS customer, from inside the API image (P26-01).
 *
 * `db/seed/ds-default.ts` is the developer-facing runner and needs `tsx`, the
 * workspace and the repository checkout. None of those exist on the production
 * host, where the only artefact is a container — and this is the one seed a
 * fresh installation is *meant* to run, so it has to be reachable there.
 *
 * It does not carry its own copy of the seed. See `db-migrate.ts` for what
 * happened the one time this repository had two copies of something like this.
 *
 * ## `--if-missing`, and why `deploy.sh` passes it
 *
 * Without it this behaves like the other seeds: it rebuilds the course's
 * content tree, which deletes learner progress against that course. With it,
 * it reads one row and returns the moment the customer exists — so a re-deploy
 * writes nothing.
 *
 * It also turns the generated participant password off in the report, because
 * an unattended run's output is a GitHub Actions log.
 *
 *   ./dsc run --rm --entrypoint node api dist/seed-ds-default.js --force
 *   ./dsc run --rm --entrypoint node api dist/seed-ds-default.js --force --if-missing
 */

import { openSeedPool, seedDsDefault } from "@ds/seed";

async function main(): Promise<void> {
  const ifMissing = process.argv.includes("--if-missing");
  const pool = openSeedPool("the default DS customer");
  try {
    // eslint-disable-next-line no-console -- this is a CLI; its output is the point
    console.log(
      await seedDsDefault(pool, {
        onlyIfMissing: ifMissing,
        // Attended runs print it; `--if-missing` is how the unattended caller
        // identifies itself, and its stdout is a build log.
        revealPassword: !ifMissing,
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // The connection string contains a password; the message must not echo it.
  console.error(
    "Seeding the default DS customer failed:",
    error instanceof Error ? error.message : "unknown error",
  );
  process.exit(1);
});
