/**
 * A screen's own sentence is drawn once.
 *
 * ## The defect
 *
 * Every navigation destination declares its page chrome in
 * `apps/admin/src/components/shell/navigation.ts` — a title and a
 * `description` — and `Page` draws both under the heading. `Section`'s own
 * documentation says why: *"the page chrome belongs to the destination, not to
 * the component that happens to fill it. Ten screens each drawing their own
 * heading is how three of them ended up with none and two with a heading in a
 * different size."*
 *
 * Two components drew their `description` **again**, at the top of their own
 * body. On **Texte** and on **Plattform-EIV** the same paragraph appeared twice,
 * one directly beneath the other.
 *
 * Nothing caught it, and nothing could have: both halves are individually
 * correct. It is §9.10b — one value, two homes — and it was only visible by
 * looking at the screen, which is how it was found.
 *
 * ## Why a script and not a test
 *
 * The question is about source across two files: is this locale key used as a
 * nav description *and* rendered by a component? A component test renders one
 * screen and cannot see the table; a test of the table cannot see the
 * components.
 *
 * A `description` reused somewhere that is not a page intro — inside a dialog,
 * say — would be flagged here too. That is deliberate: it would still be the
 * same sentence in two places, and the fix is to give the second one its own
 * key. Better a hit somebody has to look at than a class nobody can see.
 */

import { globSync, readFileSync } from "node:fs";

const NAV = "apps/admin/src/components/shell/navigation.ts";

const table = readFileSync(NAV, "utf8");
const descriptions = [...table.matchAll(/description:\s*(de\.[A-Za-z0-9_.]+)/g)].map(
  (match) => match[1],
);

if (descriptions.length === 0) {
  console.error(
    `screen-intros: parsed no descriptions out of ${NAV}, so this run proves ` +
      "nothing. The table moved or the parser is broken.",
  );
  process.exit(1);
}

const components = globSync("apps/admin/src/**/*.tsx").filter(
  (file) => !file.includes(".test."),
);

/**
 * Source with its comments removed.
 *
 * The second time in one change that a checker read its own prose. The first
 * version flagged `CopySettings.tsx` for a hit inside the **comment explaining
 * why the paragraph was deleted** — which is `check-deadlines`' defect from
 * CLAUDE.md §11 (*"It was matching prose in doc comments"*), and which
 * `scripts/aria-props.mjs` had just been fixed for.
 *
 * Twice in an afternoon makes it a shape rather than a slip: **a checker that
 * greps source is reading the explanation as well as the code, and the
 * explanation is where the thing being banned is most likely to be named.**
 * Strip comments first, always.
 */
function code(source) {
  /*
   * As many spaces and newlines as the comment occupied, never one space
   * (P228-01). This function's result is what the reported line number is
   * counted from, so collapsing a comment moves every finding after it —
   * `check-design-tokens.mjs` reported a read on line 171 as line 104 before
   * this was fixed in both places.
   */
  const blank = (match) => match.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/**
 * Where `key` is used as a whole name, or `-1`.
 *
 * A plain scan rather than `new RegExp(key + "(?![A-Za-z0-9_])")`, and the
 * reason is not style. CodeQL rates a regular expression built from file
 * content a **high**-severity finding — `js/regex-injection` — and escaping the
 * dots with `String.replace` is not a sanitiser it recognises, so the alert
 * stands however careful the escaping is. Other scripts in `scripts/` do
 * interpolate, but they interpolate a name matched by a far tighter pattern,
 * which is why they have passed for months and this did not.
 *
 * Arguing with the scanner would have been the wrong move twice over: the regex
 * was doing nothing `indexOf` cannot, and this repository has already been
 * pushed off regular expressions twice by its own lint rules (P212, P220-02).
 * A closed-list scan cannot raise the question at all.
 *
 * The right-hand boundary is the whole point: without it `de.copy.intro` also
 * matches `de.copy.introDetail`, and the checker would report a screen for
 * rendering a string it does not render.
 */
function wholeNameAt(source, key) {
  let from = 0;
  for (;;) {
    const at = source.indexOf(key, from);
    if (at === -1) return -1;
    const next = source[at + key.length] ?? "";
    const isNameChar =
      (next >= "a" && next <= "z") ||
      (next >= "A" && next <= "Z") ||
      (next >= "0" && next <= "9") ||
      next === "_";
    if (!isNameChar) return at;
    from = at + key.length;
  }
}

const problems = [];
for (const file of components) {
  const source = code(readFileSync(file, "utf8"));
  for (const key of descriptions) {
    const at = wholeNameAt(source, key);
    if (at === -1) continue;
    const line = source.slice(0, at).split("\n").length;
    problems.push(
      `${file}:${line}: renders ${key}, which is already this screen's nav ` +
        "`description` — `Page` draws it under the title, so it appears twice.",
    );
  }
}

if (problems.length > 0) {
  console.error("screen-intros: a screen draws its own sentence twice\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nDelete the paragraph from the component — the nav table is the one home " +
      "for a screen's chrome — or, if the second use is genuinely a different " +
      "sentence, give it its own locale key.",
  );
  process.exit(1);
}

console.log(
  `screen-intros: ${descriptions.length} screen description(s), each drawn once, ` +
    `across ${components.length} component file(s).`,
);
