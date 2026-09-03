/**
 * The widget's focus indicator is decided by source order, and nothing else
 * was watching it (DEP-29).
 *
 * ## The shape of the bug this exists for
 *
 * `apps/widget/src/styles.css` carries the accessibility floor:
 *
 *   .ds-lms-root :focus-visible { outline: 2px solid var(--ds-accent); }
 *
 * That selector is one class plus one pseudo-class — specificity (0,2,0). So is
 * every Tailwind utility a component writes for its own focus state, because
 * `focus-visible:outline-white` compiles to
 * `.focus-visible\:outline-white:focus-visible`. Two rules at (0,2,0) are
 * separated by **source order alone**, so while the floor sat at the bottom of
 * the file it silently beat all four components that had styled their own —
 * the player surface, its play overlay, the scrub bar, and the sticky progress
 * card's heading.
 *
 * Nothing failed. The utilities were emitted, the classes were on the elements,
 * and the wrong outline was drawn: on the sticky card, a dark-blue rectangle on
 * teal, at the moment the card opens, because focus is moved there
 * programmatically rather than by a keypress. That is CLAUDE.md §9.1 — a rule
 * that is present, applied and inert.
 *
 * ## What this asserts, and what it cannot
 *
 * Two mechanical facts, both of which would have to be *undone* for the bug to
 * come back:
 *
 * 1. the floor is declared **before** `@tailwind utilities`, and
 * 2. every component that opts out of it names a replacement in the same
 *    class list — `focus-visible:outline-*`, which ties the specificity, rather
 *    than a bare `outline-none`, which is (0,1,0) and loses.
 *
 * It cannot assert what a browser paints; that needs the journey
 * (CLAUDE.md §9.13). It can assert that the ordering the paint depends on is
 * still the one that was reasoned about, which is the part a future edit moves
 * by accident.
 *
 * Run by `pnpm verify` and by CI.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const STYLES = join(REPO, "apps/widget/src/styles.css");

const problems = [];

// ---------------------------------------------------------------------------
// 1. The floor is declared before the utilities that have to be able to beat it
// ---------------------------------------------------------------------------

const css = readFileSync(STYLES, "utf8");

/** Only the declaration, never the prose above it — a comment is not a rule. */
const floorAt = css.search(/^\.ds-lms-root :focus-visible \{/mu);
const utilitiesAt = css.search(/^@tailwind utilities;/mu);

if (floorAt === -1) {
  problems.push(
    `${STYLES}: no \`.ds-lms-root :focus-visible\` rule. Either the floor was ` +
      "removed — which is an accessibility regression, not a cleanup — or it " +
      "was renamed and this check has stopped checking anything.",
  );
} else if (utilitiesAt === -1) {
  problems.push(
    `${STYLES}: no \`@tailwind utilities;\` directive. The widget's utilities ` +
      "come from somewhere else now and the ordering reasoned about in this " +
      "file no longer applies.",
  );
} else if (floorAt > utilitiesAt) {
  problems.push(
    `${STYLES}: the \`:focus-visible\` floor is declared AFTER ` +
      "`@tailwind utilities`. It ties every `focus-visible:outline-*` utility " +
      "on specificity (0,2,0), so from there it wins on source order and every " +
      "component's own focus indicator is drawn over. Move it above the " +
      "directive.",
  );
}

// ---------------------------------------------------------------------------
// 2. Nobody opts out of the floor without naming a replacement that can win
// ---------------------------------------------------------------------------
//
// `outline-none` is `.outline-none` — (0,1,0) — and loses to the floor wherever
// it sits. A component that writes it and nothing else has not removed the
// outline; it has written a line that does nothing, which is the more expensive
// of the two outcomes because it reads as done.

const sources = globSync("apps/widget/src/**/*.tsx", { cwd: REPO }).filter(
  (file) => !file.endsWith(".test.tsx"),
);

if (sources.length === 0) {
  problems.push(
    "found no widget components to scan. The glob and the tree have drifted.",
  );
}

for (const relative of sources) {
  const source = readFileSync(join(REPO, relative), "utf8");

  // className strings only. `outline-none` inside a comment is prose about the
  // problem, not an instance of it — this file's own header would trip it.
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/gu)) {
    const classes = match[1] ?? match[2] ?? "";
    if (!/\boutline-none\b/u.test(classes)) continue;
    if (/\bfocus-visible:outline(?:-|\b)/u.test(classes)) continue;

    problems.push(
      `${relative}: a class list carries \`outline-none\` with no ` +
        "`focus-visible:outline-*` beside it. At (0,1,0) it cannot beat the " +
        "floor, so the element keeps the default accent outline and whatever " +
        "indicator was written instead is drawn underneath it. Either style " +
        "the focus state with `focus-visible:outline-*`, or drop the " +
        "`outline-none` and let the floor do its job.",
    );
  }
}

if (problems.length > 0) {
  console.error(
    "check-focus-ring: the widget's focus indicator is not decided by the code that means to decide it\n",
  );
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  console.error(`\nSee the comment above the rule in ${STYLES}.`);
  process.exit(1);
}

console.log(
  `check-focus-ring: floor precedes @tailwind utilities; ${String(sources.length)} ` +
    "component file(s) scanned, no unbacked `outline-none`",
);
