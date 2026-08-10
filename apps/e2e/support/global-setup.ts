/**
 * Everything that has to be true before the first browser opens (P35-01).
 *
 * Rebuilds the database, builds the workspace, and starts the API and both
 * frontends. The handle is stashed on `globalThis` so teardown can stop what
 * this started — Playwright's global setup and teardown are separate modules in
 * the same process, and there is no other channel between them.
 */

import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { startStack, type Stack } from "./stack.js";
import { accreditSeededCourse, prepareDatabase, KMS_KEY } from "./world.js";
import { bootstrapSuperAdmin } from "./staff.js";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

declare global {
  var __dsStack: Stack | undefined;
}

// eslint-disable-next-line no-restricted-syntax -- Playwright loads these by default export
export default async function globalSetup(): Promise<void> {
  const superuser =
    process.env["POSTGRES_SUPERUSER_URL"] ??
    "postgres://postgres:postgres@127.0.0.1:5432/postgres";

  /*
   * Build, rather than check whether a build is current.
   *
   * The same reasoning as the integration suite's `ensureFreshBuilds`: a turbo
   * cache hit writes nothing, so mtimes cannot answer "is dist/ current", and
   * the failure mode of getting it wrong is the worst available — the fix you
   * just made does not appear, in a browser, where it looks like a product bug.
   */
  const build = spawnSync("pnpm", ["build"], { cwd: REPO, encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(`the workspace does not build:\n${build.stdout}\n${build.stderr}`);
  }

  const prepared = prepareDatabase(REPO, superuser);
  await accreditSeededCourse(prepared.superuserUrl);

  /*
   * The first operator, created the way a real installation creates one, and
   * handed to the workers through the environment, which is Playwright's own
   * channel for this: `globalSetup` runs in the runner process and the tests
   * run in workers it spawns afterwards, so `globalThis` does not reach them
   * and a module-level variable is a different module instance entirely.
   */
  const staff = bootstrapSuperAdmin(REPO, prepared.databaseUrl);
  process.env["E2E_STAFF_EMAIL"] = staff.email;
  process.env["E2E_STAFF_PASSWORD"] = staff.password;

  globalThis.__dsStack = await startStack({
    repo: REPO,
    databaseUrl: prepared.databaseUrl,
    migrationUrl: prepared.migrationUrl,
    kmsKey: KMS_KEY,
  });
}
