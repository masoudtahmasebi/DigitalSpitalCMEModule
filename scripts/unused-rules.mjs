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
 *
 * ## Two defects in this script itself (P134-02)
 *
 * Both were found by reading its output rather than by running it, because a
 * check cannot report that it is lying.
 *
 * **It reported 88 symbols and 56 of them were types.** The filter matched only
 * inline `type Foo,` re-exports; `index.ts` states most of its types inside
 * `export type { … }` blocks, whose members carry no `type` keyword of their
 * own. Two thirds noise is not a check anybody reads, and §9.3's answer —
 * "somebody has to look" — stops being true the moment looking costs that much.
 *
 * **It reported symbols that are demonstrably called.** The old scan shelled out
 * to `grep -arn … | grep -v … | grep -v …`, and only the *first* stage carried
 * `-a`. `packages/domain/src/copy.test.ts` legitimately contains a NUL byte — it
 * is the fixture proving `invalidCopyKeys` rejects a control character in a copy
 * override — so a matching line put a NUL on the pipe, the second `grep`
 * declared **stdin** binary, printed "binary file matches" instead of the lines,
 * and the count came back 0. `invalidCopyKeys` and `COPY_MAX_LENGTH` were
 * reported dead while the API calls both.
 *
 * That is P76-01 exactly, one pipe stage further along: the fix was applied
 * where the problem was seen and not to the stages downstream of it, which is
 * §9.11 half-done. And it fails in the dangerous direction — a live compliance
 * rule reported as dead is a rule somebody deletes.
 *
 * So the scan is in JavaScript now. No stage can decide a stream is binary,
 * because there are no stages.
 */

// Every symbol packages/domain exports, and whether anything outside its own
// tests ever calls it. P39-01 — a token that never expired — was exactly this:
// inviteStatus and resetStatus, exported, unit-tested, called from nowhere.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const index = readFileSync("packages/domain/src/index.ts", "utf8");

/**
 * Every name `index.ts` re-exports, and which of them are types.
 *
 * Types come from two shapes and the second is the one that was missed:
 * `export type { A, B }` blocks, where the members carry no keyword of their
 * own, and inline `type A` inside a value export list.
 */
const names = [...index.matchAll(/^\s{2}(?:type )?([A-Za-z][A-Za-z0-9_]*),?$/gm)].map(
  (match) => match[1],
);

const typeNames = new Set(
  [...index.matchAll(/^\s{2}type ([A-Za-z][A-Za-z0-9_]*),?$/gm)].map((match) => match[1]),
);
for (const block of index.matchAll(/export type \{([\s\S]*?)\}/gu)) {
  for (const [, name] of block[1].matchAll(/([A-Za-z][A-Za-z0-9_]*)/gu)) {
    typeNames.add(name);
  }
}

/** Every source file that could call a rule — the domain and its tests aside. */
function callers(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) callers(path, out);
    else if (/\.tsx?$/u.test(path) && !path.includes(".test.")) out.push(path);
  }
  return out;
}

const sources = [...callers("apps"), ...callers("packages")].filter(
  (path) => !path.startsWith("packages/domain/"),
);

/*
 * Read as text, deliberately. A NUL byte in a source file is legitimate — one
 * is a test fixture for exactly the validation it appears in — and the only
 * thing it must not do is make a file invisible to this scan.
 */
const corpus = sources.map((path) => readFileSync(path, "utf8")).join("\n");

const out = [];
for (const name of new Set(names)) {
  if (typeNames.has(name)) continue;
  if (!new RegExp(`\\b${name}\\b`, "u").test(corpus)) out.push(name);
}

/*
 * The second half: a **field** nothing reads (P191-01).
 *
 * The first half sees exported names. It cannot see inside one, and that is
 * how `EivDeadlines` came to carry three judgements — `isOverdue`,
 * `shouldStopRetrying`, `needsAlert` — computed on every call, unit-tested,
 * and read by nothing outside `packages/domain`. Each duplicates a decision
 * something else already makes (`dueAlerts`, `planEivAttempt`,
 * `admin.service`'s own inline comparison), so they were not a missing feature
 * — they were a **second answer waiting for somebody to reach for it**, which
 * is the shape P190-01 shipped as a defect.
 *
 * ## The rule, chosen to keep this quiet enough to read
 *
 * A field is reported only when its own interface is part of the domain's
 * **public surface** — re-exported from `index.ts` — and the field is read
 * nowhere outside. The type being *named* outside is the wrong test and was the
 * first thing tried: nothing names `EivDeadlines`, because callers write
 * `eivDeadlines(...).reportDueAt` and never hold the type. Being exported at all
 * is the claim "somebody is meant to use this", which is what makes an unread
 * field worth a look.
 *
 * Short names are skipped: `id`, `at`, `by` and their like appear in every file
 * for unrelated reasons, so their absence is unprovable by a text scan. That is
 * a stated limit, not an oversight — a check that claims more reach than it has
 * is §9.1's second form.
 */
const MIN_FIELD_LENGTH = 5;

const domainSource = callers("packages/domain/src")
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const unreadFields = [];
for (const block of domainSource.matchAll(
  /export interface ([A-Za-z][A-Za-z0-9_]*) \{([\s\S]*?)\n\}/gu,
)) {
  const [, typeName, body] = block;

  // Only the public surface. An internal shape nobody was offered is not a
  // rule with no caller, it is an implementation detail.
  if (!typeNames.has(typeName)) continue;

  for (const [, field] of body.matchAll(
    /^\s+(?:readonly )?([a-z][A-Za-z0-9_]*)[?]?:/gmu,
  )) {
    if (field.length < MIN_FIELD_LENGTH) continue;
    if (new RegExp(`\\b${field}\\b`, "u").test(corpus)) continue;
    unreadFields.push(`${typeName}.${field}`);
  }
}

console.log(out.length === 0 ? "none" : out.join("\n"));

if (unreadFields.length > 0) {
  console.log(`\nfields nobody outside packages/domain reads:`);
  console.log(unreadFields.map((entry) => `  ${entry}`).join("\n"));
}
