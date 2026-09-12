/**
 * A screen that saves something also says when it has not saved it yet.
 *
 * ## The defect
 *
 * Nothing in the console guarded an in-progress edit (P234-01) — a navigation
 * click, a reload or a closed tab discarded it silently. `ProjectSettings`
 * alone holds twenty-odd fields including an SMTP password.
 *
 * Adopting `useUnsavedChanges` everywhere fixed the instances. This is the
 * part that keeps it fixed, because the failure mode of a guard is not that it
 * breaks — it is that the **eleventh** form is written without it, and a guard
 * covering ten of eleven screens is worse than none: it teaches the operator
 * that the console warns them, and then one day it does not (§9.2).
 *
 * ## The rule, and why `useSaver` is the right trigger
 *
 * Every component that calls `useSaver` calls `useUnsavedChanges`, or is named
 * below with the reason it does not.
 *
 * `useSaver` is the marker because it means *"this component performs a write"*,
 * which is exactly the population that can hold an unwritten one. It is not a
 * perfect proxy — a form could hand-roll its save — and `check:savers` already
 * refuses that separately, so between the two there is no way to add a saving
 * screen that neither guards its control nor its draft.
 *
 * ## The exemption list is two entries and both are "nothing to lose"
 *
 * Not "not done yet". A list that mixes *correct* with *pending* is the mute
 * button P225's `ANSWERS_WITH_NOT_FOUND` and P230's `COVERED_DIFFERENTLY` were
 * each written to avoid, and the way it starts is one entry meaning "later".
 */

import { globSync, readFileSync } from "node:fs";

/**
 * Components that write but can never hold an unwritten edit.
 *
 * Each entry states why, and each reason is a property of the component rather
 * than a plan. If a reason stops being true the entry is wrong, which is a
 * thing a reader can check.
 */
const NOTHING_TO_LOSE = new Map([
  [
    "Security.tsx",
    "saves on change — a second-factor policy is written the moment the " +
      "control moves, so there is never a pending draft. A flag here would be " +
      "one nothing can set.",
  ],
  [
    "EivCheck.tsx",
    "runs a connection test. The password it holds is typed to authenticate " +
      "one check and is never stored by anything, so there is no unsaved work " +
      "— losing it costs retyping, not losing.",
  ],
]);

/** Comments blanked, keeping line and column (P228-03). */
function code(source) {
  const blank = (match) => match.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

const files = globSync("apps/admin/src/**/*.tsx").filter((f) => !f.includes(".test."));
if (files.length === 0) {
  console.error("check-unsaved-guard: matched no component files. The tree moved.");
  process.exit(1);
}

const problems = [];
let savers = 0;
let guarded = 0;
const used = new Set();

for (const file of files) {
  const source = code(readFileSync(file, "utf8"));
  if (!/\buseSaver\s*\(/.test(source)) continue;
  savers += 1;

  const name = file.slice(file.lastIndexOf("/") + 1);
  if (/\buseUnsavedChanges\s*\(/.test(source)) {
    guarded += 1;
    continue;
  }
  if (NOTHING_TO_LOSE.has(name)) {
    used.add(name);
    continue;
  }
  problems.push(
    `${file}: calls \`useSaver\` and never \`useUnsavedChanges\`, so an edit ` +
      "in progress on this screen is discarded without a word when the " +
      "operator navigates, reloads, or closes the tab. Register it, or add it " +
      "to NOTHING_TO_LOSE with the reason it cannot hold one.",
  );
}

if (savers === 0) {
  console.error(
    "check-unsaved-guard: found no component calling `useSaver`, so this run " +
      "proves nothing. The hook was renamed or the tree moved.",
  );
  process.exit(1);
}

/*
 * An exemption nobody needs is how the list stops meaning anything — P230-02's
 * lesson, in the place it applies next.
 */
for (const [name, reason] of NOTHING_TO_LOSE) {
  if (used.has(name)) continue;
  problems.push(
    `NOTHING_TO_LOSE names \`${name}\` — "${reason}" — but it does not call ` +
      "`useSaver`, or it now guards itself. Remove the entry.",
  );
}

if (problems.length > 0) {
  console.error(`check-unsaved-guard: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}

console.log(
  `check-unsaved-guard: ${savers} component(s) save something; ${guarded} ` +
    `guard an edit in progress and ${used.size} cannot hold one.`,
);
