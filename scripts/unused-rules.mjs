/**
 * Rules `@ds/domain` states and nothing enforces (P41-01).
 *
 * ## Why this exists
 *
 * `packages/domain` is where every compliance decision lives, and it is the
 * one place in this repository with effectively total test coverage. That makes
 * a rule written there feel *done* — and it is exactly half done, because
 * nothing in the domain calls anything: the API has to.
 *
 * Two defects found this way, both of which had passed every gate for months:
 *
 * - `inviteStatus` and `resetStatus` — expiry, single-use and revocation for
 *   credential tokens. Exported, unit-tested against their boundaries, called
 *   from nowhere. An invitation link was a permanent, replayable key to a
 *   console account (P39-01).
 * - `invalidBrandingFields`, whose own comment says *"an admin saving a value
 *   deserves to be told it was rejected"*. Nothing called it, so the save
 *   silently dropped the field and answered "Gespeichert." (P41-01).
 *
 * ## What a hit means
 *
 * Not necessarily a bug. A helper used only inside the domain, or a constant
 * held for a feature not yet built, is a legitimate hit — `UPLOAD_MAX_BYTES`
 * says so in its own comment. What it means is **somebody has to look**, which
 * is more than was happening before.
 *
 * Types are skipped: an unused type is dead weight, not an unenforced rule.
 */

// Every symbol packages/domain exports, and whether anything outside its own
// tests ever calls it. P39-01 — a token that never expired — was exactly this:
// inviteStatus and resetStatus, exported, unit-tested, called from nowhere.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const index = readFileSync("packages/domain/src/index.ts", "utf8");
const names = [...index.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*),?$/gm)].map((m) => m[1]);
const typeNames = new Set(
  [...index.matchAll(/^\s{2}type ([A-Za-z][A-Za-z0-9_]*),?$/gm)].map((m) => m[1]),
);

const out = [];
for (const name of new Set(names)) {
  if (typeNames.has(name)) continue;
  const hits = execSync(
    `grep -rn "\\b${name}\\b" apps packages --include=*.ts --include=*.tsx ` +
      `| grep -v "packages/domain/" | grep -v "\\.test\\." | wc -l`,
    { encoding: "utf8" },
  ).trim();
  if (hits === "0") out.push(name);
}
console.log(out.length === 0 ? "none" : out.join("\n"));
