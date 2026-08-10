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
 * ## Why the MEDICE seed is here too
 *
 * This header used to say the opposite — that MEDICE's content belonged in a
 * developer-only fixture because a course carrying a real VNR should reach
 * production through the admin console. The reasoning was sound and the
 * consequence was not: the seed that creates the first customer's course was
 * the one seed that could not run on the host serving that customer, and
 * `fortbildung.digitalspital.com/medice` was empty with nothing to explain why
 * (P24-02).
 *
 * The concern it was protecting against is real and is handled where it
 * belongs: the seed writes no VNR password, so nothing it creates can file a
 * Punktemeldung, and `openSeedPool` refuses a non-local database unless the
 * operator passes `--force`.
 */

export {
  enterTenant,
  LOCAL_REALM,
  openSeedPool,
  participantPassword,
  PLACEHOLDER_IMAGE,
  resetCourseContent,
  seedParticipant,
  seedPortalProject,
  seededPassword,
  type SeededPassword,
  upsert,
} from "./lib.js";
export { seedDsDefault, type DsDefaultOptions } from "./ds-default.js";
export { seedDsDemo } from "./ds-demo.js";
export { seedMediceAdhs } from "./medice-adhs.js";
export {
  describeDemoStaff,
  seedDemoStaff,
  type DemoStaffAccount,
  type DemoStaffOptions,
  type DemoStaffRole,
} from "./staff.js";
