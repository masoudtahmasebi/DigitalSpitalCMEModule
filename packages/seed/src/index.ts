/**
 * Seeds that have to run in two places (P20-01).
 *
 * ## Why this is a package
 *
 * A seed written under `db/seed/` needs `tsx`, the workspace and the
 * repository checkout. None of the three exist on the production host, where
 * the only artefact is a container — so a seed that lives only there can never
 * be run against the deployment it was written for.
 *
 * `@ds/migrator` solved the same problem the same way, and for the same reason
 * stated in `apps/api/src/db-migrate.ts`: there was briefly a second copy of
 * the migration algorithm inside the image, whose header claimed the two were
 * "deliberately the same algorithm, not a second one" while being exactly
 * that — and both copies shared a bug only production could expose.
 *
 * So the seed lives here, once, and both entrypoints are a `main()` over it:
 * `db/seed/ds-demo.ts` for a developer with a checkout, and
 * `apps/api/src/seed-ds.ts` for the image.
 *
 * ## What is deliberately not here
 *
 * The MEDICE seed. Its content belongs to a customer and reaches production
 * through the admin console, not through a script — seeding a course that
 * carries a real VNR from a file in this repository is how a placeholder gets
 * a Punktemeldung. It stays a development fixture under `db/seed/adhs.ts`.
 */

export {
  enterTenant,
  openSeedPool,
  PLACEHOLDER_IMAGE,
  resetCourseContent,
  upsert,
} from "./lib.js";
export { seedDsDemo } from "./ds-demo.js";
