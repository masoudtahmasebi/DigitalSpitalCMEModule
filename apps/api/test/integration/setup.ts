/**
 * What every integration run checks before the first test (P32-01).
 *
 * Three guards, each for a failure that cost real time in this project rather
 * than a hypothetical one.
 *
 * ## 1. The database must be local
 *
 * These suites truncate. A `DATABASE_URL` copied from a deployment into a
 * terminal is not a far-fetched accident, and the damage is not recoverable by
 * apologising. Local hosts only, and there is no override — the only reason to
 * want one is the reason this exists.
 *
 * ## 2. The workspace builds must be current
 *
 * `@ds/domain`, `@ds/sdk` and `@ds/eiv-client` are consumed through their
 * `dist/`. `pnpm test:integration` builds them because turbo says
 * `dependsOn: ["^build"]`, but running vitest directly — which is what anybody
 * does when iterating on one suite — does not.
 *
 * The symptom is the worst kind: **the fix you just made does not appear, and
 * the test fails exactly as before**. It cost five separate debugging detours
 * in one session, each ending in "rebuild and it passes".
 *
 * So this *runs* the build rather than checking it. The first attempt compared
 * mtimes and was wrong in a way worth recording: a turbo cache hit replays the
 * logs and writes nothing, so `dist/` keeps an older mtime than a `src/` that
 * it nonetheless corresponds to exactly. The check reported every up-to-date
 * package as stale. Running the build is a guarantee instead of a heuristic,
 * and it costs 0.45 s when the cache is warm — cheaper than the check it
 * replaced was wrong.
 *
 * ## 3. Leftovers must not accumulate
 *
 * When asked (`INTEGRATION_RESET=1`, which `pnpm test:integration` sets), every
 * tenant table is truncated first. Without it the suite writes ~50 customers
 * per run into whatever database it is pointed at and never removes them; the
 * development database reached 1096 customers before anybody counted, and
 * `eiv-worker.integration.test.ts` carried a workaround for the resulting
 * cross-suite interference. Truncating makes a run mean the same thing on the
 * first day and the hundredth.
 *
 * Four tests failed the first time this ran, which is the argument for it:
 * they had been passing on state a migration established weeks earlier, and
 * nobody could have told you which.
 *
 * This is the run-level reset. It is **not** sufficient on its own — a file
 * still saw every earlier file's rows, which broke the EIV worker's sweep tally
 * on the third run. `support/reset-each-file.ts` repeats it before every file
 * and explains why. This one stays because it also covers the case of a suite
 * pointed at a database somebody else left data in.
 */

import { spawnSync } from "node:child_process";
import { resetDatabase } from "./support/reset.js";

const REPO = new URL("../../../../", import.meta.url).pathname;

/**
 * Build the workspace, so the suites import the code under test.
 *
 * Delegated to turbo rather than reimplemented: turbo already knows which
 * packages exist, what they depend on and whether anything changed. A cache
 * hit is half a second and writes nothing.
 */
function ensureFreshBuilds(): void {
  const result = spawnSync("pnpm", ["build"], {
    cwd: REPO,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        "The workspace does not build, so the integration suite would be",
        "testing whatever was last compiled rather than the current source.",
        "",
        result.stdout ?? "",
        result.stderr ?? "",
      ].join("\n"),
    );
  }
}

function assertLocalDatabase(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(
      `Refusing to run the integration suite against ${host}. ` +
        "These tests truncate every tenant table; they may only ever point at a local cluster.",
    );
  }
}

export async function setup(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL must be set to run the integration suite.");
  }

  assertLocalDatabase(url);
  ensureFreshBuilds();

  if (process.env["INTEGRATION_RESET"] === "1") {
    const superuser = process.env["POSTGRES_SUPERUSER_URL"];
    // The superuser, because RLS applies to `ds_app` and truncation must not
    // be a tenant-scoped operation.
    await resetDatabase(superuser === undefined || superuser === "" ? url : superuser);
  }
}
