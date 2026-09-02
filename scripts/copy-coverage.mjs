/**
 * Copy strings the product never renders (P123-02).
 *
 * ## Why this exists
 *
 * `packages/copy/src/de.ts` is 1,000 lines of German written for physicians,
 * and every string in it is covered by `check:i18n` — which counts whether a
 * German key has an English counterpart, and is completely satisfied by a
 * sentence no screen has ever drawn. That is CLAUDE.md §9.1's second form: a
 * check that silently covers less than it looks like it covers.
 *
 * It is also §9.3 one layer out from where that rule was written. There, a
 * *rule* exhaustively unit-tested and called from nowhere; here, a *sentence*
 * carefully worded, reviewed, translated, and rendered by nothing. Three were
 * found by hand while walking the test pack:
 *
 *   * `player.examInModule` — P95-01 wrote it so a physician could tell three
 *     identically-named Lernerfolgskontrolle rows apart. The rows are still
 *     identical.
 *   * `player.quizLocked` and `player.reportingLocked` — two sentences saying
 *     what opens a locked section, which is §9.4's whole point.
 *
 * None of them is a crash. Each is a screen quietly less helpful than the
 * person who wrote the copy believed, for as long as nobody looks.
 *
 * ## How it decides
 *
 * The copy module is *imported*, not parsed: the shape is the authority, and a
 * regex over TypeScript would disagree with it eventually. Every leaf path is
 * walked, then the source is searched for the leaf's name as a property access.
 *
 * **Computed access defeats the search on purpose.** `de.tabs[entry]` and
 * `de.player.state[kind]` are legitimate and name no leaf, so any object read
 * with a `[` is treated as wholly used — over-reporting a key as *used* is a
 * check that stays quiet, and under-reporting it is a check nobody trusts. When
 * in doubt this file stays quiet, which is the honest failure direction for a
 * gate that is meant to be run rather than argued with.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Where copy may legitimately be read from. */
const SOURCE_DIRS = ["apps/widget/src", "apps/admin/src", "apps/e2e", "packages/sdk/src"];

/** Files that define the copy rather than consume it. */
const DEFINITION = /packages\/copy\//;

function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

/** Every leaf path in the copy tree, plus every object read with a computed key. */
function leaves(node, path, acc, objects) {
  for (const [key, value] of Object.entries(node)) {
    const next = [...path, key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      objects.push(next.join("."));
      leaves(value, next, acc, objects);
    } else {
      acc.push(next.join("."));
    }
  }
}

const { de } = await import(
  new URL("../packages/copy/dist/index.js", import.meta.url).href
);

const paths = [];
const objects = [];
leaves(de, [], paths, objects);

const haystack = SOURCE_DIRS.flatMap(sourceFiles)
  .filter((f) => !DEFINITION.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/** An object whose members are reached by a computed key — treat all as used. */
const dynamic = new Set(
  objects.filter((path) => {
    const leaf = path.split(".").pop();
    return new RegExp(`\\.${leaf}\\s*\\[`).test(haystack);
  }),
);

const unused = paths.filter((path) => {
  if ([...dynamic].some((parent) => path.startsWith(`${parent}.`))) return false;
  const leaf = path.split(".").pop();
  return !new RegExp(`\\.${leaf}\\b`).test(haystack);
});

/**
 * The strings that were already dead when this check was written (P123-02).
 *
 * A baseline rather than a silencer, and it moves in one direction — the same
 * shape as `MINIMUM` in `i18n-coverage.mjs`. A key removed from here can never
 * come back without failing the build, and a *new* dead string fails it
 * immediately, which is the case this check exists to prevent.
 *
 * Each was looked at rather than counted (§9.3: a hit is not automatically a
 * bug). The annotation is the finding:
 *
 *   * **obsolete** — the screen it belonged to is not built, or was rebuilt
 *     around a different string. Safe to delete; kept here for one pass so the
 *     deletion is a decision somebody makes rather than a side effect of this
 *     check landing.
 *   * **layout** — written for an arrangement the MEDICE renders draw and the
 *     product does not. Wiring it blind would invent a screen; it belongs in a
 *     question to the client.
 *   * **raise** — a real gap, and what should replace the string is not mine
 *     to decide (§7).
 */
const BASELINE = new Map([
  ["catalog.filterHeading", "obsolete — the filter row labels its own selects"],
  ["overviewTab.moduleLabel", "obsolete — the outline numbers its modules itself"],
  [
    "signedOut.expiredTitle",
    "raise — no screen tells a mid-course expiry from a missing token",
  ],
  ["signedOut.expiredMessage", "raise — same"],
  ["player.toggleModule", "obsolete — superseded by the counted variant (P93-03)"],
  ["player.tabLocked", "layout — the padlocked tab draws an icon, not this word"],
  [
    "player.quizLocked",
    "layout — P93-03's sentence is drawn from the gate, not from here",
  ],
  ["player.quizOpen", "layout — same row"],
  [
    "player.examInModule",
    "layout — the sidebar nests exams under their module already (P95-01)",
  ],
  [
    "player.reportingLocked",
    "layout — the reporting row is reached from the passed screen",
  ],
  ["player.reportingOpen", "layout — same row"],
  ["gate.lockedHint", "raise — a locked section says Gesperrt and not what opens it"],
  ["gate.available", "obsolete — an available section is drawn without a word"],
  ["media.quality", "obsolete — there is no quality selector"],
  ["media.qualityAuto", "obsolete — same"],
  [
    "content.videoUnsupported",
    "raise — a browser that cannot play the video says nothing",
  ],
  ["quiz.scoreOf", "obsolete — the score is drawn as its own figure"],
  [
    "quiz.claimWithoutPoints",
    "raise — a nought-point course still offers to claim points",
  ],
]);

const known = unused.filter((path) => BASELINE.has(path));
const fresh = unused.filter((path) => !BASELINE.has(path));
const revived = [...BASELINE.keys()].filter((path) => !unused.includes(path));

if (revived.length > 0) {
  console.log(
    `copy: ${revived.length} baselined string(s) are now rendered — remove from BASELINE:`,
  );
  for (const path of revived) console.log(`  de.${path}`);
}

if (fresh.length === 0) {
  console.log(
    `copy: ${paths.length} strings, ${known.length} known-dead (baselined), 0 new.`,
  );
  process.exit(revived.length > 0 ? 1 : 0);
}

console.error(
  `copy: ${fresh.length} string(s) are rendered by nothing and are not baselined.\n\n` +
    "Each is a sentence somebody wrote for a physician to read, that no screen\n" +
    "draws. Either wire it up, or delete it — a locale file that keeps its dead\n" +
    "entries is one nobody can read to find out what the product says.\n",
);
for (const path of fresh) console.error(`  de.${path}`);
process.exit(1);
