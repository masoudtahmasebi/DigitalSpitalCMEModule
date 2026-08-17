/**
 * How much of the console is actually translated (P88-03).
 *
 * ## Why this exists
 *
 * `overlay` falls back to German for any key English does not have, which is
 * the right behaviour — a missing string renders as a legible sentence rather
 * than a key name. It is also why the gap is invisible: for nine phases the
 * language switch worked, every screen rendered, and **36 of 639 strings** were
 * in English. Nothing was broken; it was simply not done, and no check said so.
 *
 * That is CLAUDE.md §9.1 exactly. A fallback that hides its own absence is a
 * green gate that could never go red.
 *
 * ## What it measures, and what it deliberately does not
 *
 * The **share of German strings that have an English counterpart**, by walking
 * both tables. It does not judge the translation: a check cannot tell good
 * English from bad, and pretending otherwise would be a number nobody trusts.
 *
 * Functions are excluded from both sides. A `(count: number) => string` is
 * grammar rather than copy — German plural rules are in the code — and
 * translating one means writing a second function, which is a change to
 * `de.ts` rather than an entry here. They are reported separately so the
 * exclusion is visible rather than assumed.
 *
 * ## The floor moves in one direction
 *
 * `MINIMUM` fails the build below its value. Raise it when the translation
 * improves; never lower it to make a build pass — a lowered floor is the check
 * being deleted one number at a time.
 */

import { readFileSync } from "node:fs";

/**
 * The floor, as a percentage of translatable strings.
 *
 * 95 rather than 100. The last few are strings whose English is a judgement
 * call somebody at DigitalSpital should make — a customer-facing term, a legal
 * phrase — and a check that demanded 100 would be answered by inventing them,
 * which is worse than leaving them in German where an operator can at least
 * recognise the word from the paperwork.
 */
const MINIMUM = 95;

/**
 * Keys deliberately left in German, and why.
 *
 * The accreditation vocabulary appears verbatim on the Anerkennungsbescheid and
 * in the EIV-FOBI interface. An operator reconciling the screen against the
 * paperwork needs the same token in both places, so these are **not** counted
 * as missing — they are counted as done, in German, on purpose.
 *
 * Empty for now: every such term is currently carried inside an English
 * sentence rather than being a whole entry of its own. The list exists so that
 * the next one has somewhere to go other than a lowered floor.
 */
const INTENTIONALLY_GERMAN = new Set([]);

/**
 * Every leaf key of a locale table, split by whether it is a plain string.
 *
 * Parsed out of the source rather than imported: these are TypeScript modules
 * with `as const` and a type-only import, and running them would mean a build
 * step for a check that has to be cheap enough to sit in `pnpm verify`.
 *
 * The parser tracks brace depth to build the dotted path, so `media.kinds.all`
 * is distinguishable from a top-level `all`. It is deliberately simple and it
 * asserts its own reach below: a table it under-counts would make the
 * percentage look better than it is, which is the one failure mode that
 * matters here.
 */
function keysOf(path) {
  const source = readFileSync(path, "utf8");
  const strings = new Set();
  const functions = new Set();

  const stack = [];
  let inBlockComment = false;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();

    // Comments are skipped wholesale. A commented-out key is not a key, and
    // prose inside a block comment routinely contains `word: "..."`.
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (line.startsWith("/*")) {
      if (!line.includes("*/")) inBlockComment = true;
      continue;
    }
    if (line.startsWith("//") || line.startsWith("*")) continue;

    const opens = /^([a-zA-Z_][\w]*):\s*\{$/u.exec(line);
    if (opens !== null) {
      stack.push(opens[1]);
      continue;
    }

    if (line.startsWith("}")) {
      stack.pop();
      continue;
    }

    const entry = /^([a-zA-Z_][\w]*):\s*(.*)$/u.exec(line);
    if (entry === null) continue;

    const key = [...stack, entry[1]].join(".");
    const value = entry[2] ?? "";

    /*
     * Anything that is not a function, an object or an array is a string.
     *
     * Written as an exclusion rather than a list of openers, because the third
     * form caught this parser out: `required: LABEL_REQUIRED` is a string held
     * in a constant, and matching only on a quote classified it as neither —
     * which then reported the *English* entry as an orphan key. A rule that
     * silently drops a key makes the percentage look better than it is.
     *
     * The empty case is a value on the following line, which prettier produces
     * for every long sentence in these files.
     */
    if (value.startsWith("(")) functions.add(key);
    // `{` catches an empty group written inline as `language: {},`, which the
    // opener regex above does not see because it requires a bare `{`.
    else if (!value.startsWith("[") && !value.startsWith("{")) strings.add(key);
  }

  return { strings, functions };
}

const de = keysOf("apps/admin/src/locale/de.ts");
const en = keysOf("apps/admin/src/locale/en.ts");

/*
 * The parser has to be able to be wrong loudly.
 *
 * A regex that silently matched nothing would report 100 % coverage of an empty
 * set, which is the §9.1 trap this whole file is about. The German table has
 * had more than four hundred strings since P30; a run that finds fewer is a
 * broken parser rather than a shrunken console.
 */
if (de.strings.size < 400) {
  console.error(
    `i18n-coverage: only ${String(de.strings.size)} German strings found — ` +
      "the parser is broken, not the locale file.",
  );
  process.exit(1);
}

const missing = [...de.strings]
  .filter((key) => !en.strings.has(key) && !INTENTIONALLY_GERMAN.has(key))
  .sort();

const translated = de.strings.size - missing.length;
const percent = Math.floor((translated / de.strings.size) * 100);

/*
 * A key English has that German does not is a typo, and it is invisible without
 * this: `overlay` ignores it, so the entry sits in the file forever, translated
 * and unreachable — CLAUDE.md §9.3, in a locale table.
 */
const orphans = [...en.strings].filter((key) => !de.strings.has(key)).sort();

console.log(
  `i18n-coverage: ${String(translated)}/${String(de.strings.size)} strings ` +
    `(${String(percent)} %), ${String(de.functions.size)} functions excluded`,
);

if (orphans.length > 0) {
  console.error(
    `\ni18n-coverage: ${String(orphans.length)} English key(s) with no German ` +
      "counterpart. `overlay` never reads these — they are typos:\n" +
      orphans.map((key) => `  ${key}`).join("\n"),
  );
  process.exit(1);
}

if (percent < MINIMUM) {
  console.error(
    `\ni18n-coverage: below the floor of ${String(MINIMUM)} %.\n` +
      `${String(missing.length)} string(s) still German only:\n` +
      missing.map((key) => `  ${key}`).join("\n") +
      "\n\nAdd them to apps/admin/src/locale/en.ts. Do not lower the floor.",
  );
  process.exit(1);
}
