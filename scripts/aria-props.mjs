/**
 * Every `aria-*` written on one of our own components is a prop that component
 * actually declares.
 *
 * ## The hole this covers, which types cannot
 *
 * A **hyphenated** JSX attribute is never checked against a component's props,
 * because it cannot be a JavaScript identifier. So
 *
 *     <Button aria-label={de.language.switchTo(…)}>EN</Button>
 *
 * compiles, lints, renders — and if `Button` does not declare `"aria-label"`,
 * React drops it and the control's accessible name silently becomes its visible
 * text. It is CLAUDE.md §9.3 in the one place a type cannot say so: the rule is
 * written at the call site, it looks enforced, and it is not.
 *
 * This has now happened twice. P68-02 found three fields in the video sources
 * editor announcing "Eingabefeld, leer" and fixed `TextInput` and `Select`.
 * `Button` kept a camelCase `ariaLabel`, so the console's language switch was
 * named "EN" to a screen reader from P86-01 until P223 — to the one person who
 * most needs that control, being the one who cannot read the current language.
 *
 * Fixing the instance twice is what §9.11 is about. This is the class.
 *
 * ## What it does
 *
 * For every `<Capitalised … aria-x=…>` in the front-end sources, find that
 * component's own props declaration in the repository and require the exact key
 * to appear in it.
 *
 * ## What it deliberately reports rather than skips
 *
 * A component whose definition cannot be found is **counted and named**, not
 * quietly passed over. A checker that silently covers less than it claims is
 * §9.1's second form, and this script exists because of a defect of exactly
 * that shape — so it prints its own coverage and fails if it can resolve
 * nothing at all.
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const SOURCES = globSync("apps/*/src/**/*.tsx").filter(
  (file) => !file.includes(".test."),
);

/** Which app a file belongs to — `apps/admin`, `apps/widget`. */
function app(file) {
  return file.split("/").slice(0, 2).join("/");
}

/**
 * Where each component's props object literal begins.
 *
 * Matched on the declaration rather than the name alone, so a component
 * *mentioned* in a comment is not mistaken for one defined here.
 */
function declarations() {
  const found = new Map();
  for (const file of SOURCES) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /(?:export )?function ([A-Z][A-Za-z0-9_]*)\s*\(\s*props:\s*\{/g,
    )) {
      const start = match.index + match[0].length - 1;
      const props = withoutComments(balanced(source, start));
      /*
       * Keyed by name *and* file, because `Button` is declared in both the
       * console and the learner widget. A bare-name map let the last file
       * scanned win — which happened to be the right one, by alphabet, and
       * would have silently checked admin call sites against the widget's
       * component the day somebody renamed a directory.
       */
      found.set(`${app(file)}:${match[1]}`, { file, props });
    }
  }
  return found;
}

/**
 * A props block with its comments removed.
 *
 * Stripping them is not tidiness — it is the whole difference between this
 * check working and only appearing to. The first version matched the raw block,
 * and the doc comment on `Button` explaining the `"aria-label"` decision
 * contains the string `"aria-label"`. So the declaration could be renamed to
 * anything at all and the check stayed green, because it was reading the
 * paragraph *about* the rule instead of the rule.
 *
 * That is the `check-deadlines` defect from CLAUDE.md §11, reproduced exactly:
 * *"It was matching prose in doc comments."* Found here by breaking the
 * declaration on purpose and watching the check refuse to notice (§9.1) — which
 * is the only reason it is not still there.
 */
function withoutComments(block) {
  return block.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** The text of the brace-balanced block starting at `open`. */
function balanced(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

const declared = declarations();
const problems = [];
let checked = 0;
const unresolved = new Set();

for (const file of SOURCES) {
  const source = readFileSync(file, "utf8");
  for (const tag of source.matchAll(
    /<([A-Z][A-Za-z0-9_]*)((?:[^<>{]|\{[^{}]*\})*?)\/?>/g,
  )) {
    const [, name, attributes] = tag;
    for (const attribute of attributes.matchAll(/\b(aria-[a-z]+)=/g)) {
      const key = attribute[1];
      const definition = declared.get(`${app(file)}:${name}`);
      if (definition === undefined) {
        unresolved.add(`${name} (used in ${file})`);
        continue;
      }
      checked += 1;
      // The *declaration*, not a mention: `"aria-label"?:` or `"aria-label":`.
      if (!new RegExp(`"${key}"\\s*\\??\\s*:`).test(definition.props)) {
        const line = source.slice(0, tag.index).split("\n").length;
        problems.push(
          `${file}:${line}: <${name} ${key}=…> — ${name} does not declare "${key}", ` +
            `so React drops it. Declared in ${definition.file}.`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("aria-props: an aria attribute is being silently dropped\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    "\nAdd the key to that component's props — hyphenated and quoted, the way " +
      "`TextInput` declares it — and forward it to the element it renders.",
  );
  process.exit(1);
}

if (checked === 0) {
  console.error(
    "aria-props: resolved no component at all, so this run proves nothing. " +
      "The scanner or the source glob is broken.",
  );
  process.exit(1);
}

console.log(
  `aria-props: ${checked} aria attribute(s) on ${declared.size} of our own components, ` +
    `every one declared.`,
);
if (unresolved.size > 0) {
  console.log(
    `  not resolved (defined elsewhere, not checked): ${[...unresolved].join(", ")}`,
  );
}
