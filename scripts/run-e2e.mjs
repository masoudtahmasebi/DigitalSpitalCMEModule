/**
 * One command for the browser suite (P35-01).
 *
 * The same shape as `run-integration.mjs`, and for the same reason: the suite
 * needs a database URL, a superuser URL and a browser path, and a command that
 * makes somebody remember three of those is a command that gets run wrong.
 *
 * The browser is the one the image already ships. `playwright install` would
 * download a second copy of Chromium into a container that has one, which is
 * both slow and — behind a proxy that blocks most hosts — usually a failure.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the pre-installed Chromium lives, newest layout first. */
function findChromium() {
  const explicit = process.env["E2E_CHROMIUM"];
  if (explicit !== undefined && explicit !== "") return explicit;

  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
  for (const candidate of [
    join(root, "chromium", "chrome-linux", "chrome"),
    join(root, "chromium-1194", "chrome-linux", "chrome"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const chromium = findChromium();
if (chromium === undefined) {
  console.error(
    "e2e: no Chromium found. Set E2E_CHROMIUM to a browser binary, or\n" +
      "     PLAYWRIGHT_BROWSERS_PATH to the directory Playwright installed one in.",
  );
  process.exit(1);
}

// `pnpm test:e2e -- --grep x` hands the bare `--` through as well, and
// Playwright reads it as a file filter and finds nothing. Dropping it makes the
// passthrough behave the way `run-integration.mjs` already does.
const passThrough = process.argv.slice(2).filter((arg) => arg !== "--");

const result = spawnSync("npx", ["playwright", "test", ...passThrough], {
  cwd: join(REPO, "apps/e2e"),
  stdio: "inherit",
  env: {
    ...process.env,
    E2E_CHROMIUM: chromium,
    POSTGRES_SUPERUSER_URL:
      process.env["POSTGRES_SUPERUSER_URL"] ??
      "postgres://postgres:postgres@127.0.0.1:5432/postgres",
  },
});

process.exit(result.status ?? 1);
