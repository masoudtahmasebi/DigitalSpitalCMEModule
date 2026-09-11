/**
 * Package `wordpress/ds-lms` as an installable zip (P214-02).
 *
 * ## Why this is a script and not a `zip -r` in a message
 *
 * Because the last two things this repository learned about deployment were
 * both about the gap between "the file exists here" and "the thing is applied
 * there" (CLAUDE.md §9.9 and §9.9a). A plugin zip is that gap made physical:
 * it is the one artefact of this project that a **human carries by hand** to a
 * server we do not control, and it will be installed months apart from the
 * commit that produced it.
 *
 * So the zip says what it is. `ds-lms-<version>.zip` takes its version from
 * `ds-lms.php`, never from an argument — a number typed at a terminal is a
 * number that can disagree with the plugin inside.
 *
 * ## What it refuses to do
 *
 * Ship a plugin whose three version strings disagree, and ship one whose tests
 * do not pass. Both are run here rather than assumed, because this is the last
 * point at which either can be checked: after this it is a binary in somebody's
 * downloads folder.
 *
 * `tests/` is excluded from the archive — it is the suite, not the product, and
 * it carries a harness that redefines WordPress functions. Nothing would load
 * it inside a real install, and shipping code that redefines `wp_verify_nonce`
 * to a customer's server is not a risk worth taking for a file nobody reads
 * there. It stays in the repository, where it runs.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = "wordpress/ds-lms";
const OUT = "dist/wordpress";

const bootstrap = readFileSync(join(PLUGIN, "ds-lms.php"), "utf8");
const header = /^ \* Version:\s+(\S+)$/m.exec(bootstrap)?.[1];
const constant = /define\( 'DS_LMS_VERSION', '([^']+)' \)/.exec(bootstrap)?.[1];

const changelog = readFileSync(join(PLUGIN, "CHANGELOG.md"), "utf8");
const newest = /^## (\S+) —/m.exec(changelog)?.[1];

if (header === undefined || constant === undefined || newest === undefined) {
  console.error("build-wp-plugin: could not read all three version strings.");
  process.exit(1);
}

if (header !== constant || header !== newest) {
  console.error(
    "build-wp-plugin: the three version strings disagree — refusing to build.\n" +
      `  ds-lms.php header:   ${header}\n` +
      `  DS_LMS_VERSION:      ${constant}\n` +
      `  CHANGELOG.md newest: ${newest}\n\n` +
      "An operator reads the header; a screen reads the constant. A plugin that\n" +
      "answers two different numbers is worse than one with no version at all.",
  );
  process.exit(1);
}

// The suite, here, because after this it is a binary somebody carries away.
execFileSync("php", [join(PLUGIN, "tests/security-test.php")], { stdio: "inherit" });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const archive = join(process.cwd(), OUT, `ds-lms-${header}.zip`);

/*
 * Zipped from `wordpress/`, so every path inside begins `ds-lms/`.
 *
 * WordPress installs a zip by unpacking it into `wp-content/plugins/`, so the
 * directory name comes from the archive. A zip made from inside the plugin
 * folder unpacks as loose files and installs as a broken plugin — and the
 * failure looks like a corrupt download rather than a packaging mistake.
 */
execFileSync("zip", ["-r", "-q", "-X", archive, "ds-lms", "-x", "ds-lms/tests/*"], {
  cwd: "wordpress",
  stdio: "inherit",
});

const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
  .split("\n")
  .filter((line) => line !== "");

console.log(`build-wp-plugin: ${OUT}/ds-lms-${header}.zip`);
console.log(`  ${listing.length} entries, version ${header} in all three places`);
for (const entry of listing) console.log(`    ${entry}`);
