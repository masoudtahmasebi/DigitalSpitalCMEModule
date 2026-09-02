/**
 * That no outbound call in server code can wait for ever (P144-01).
 *
 * ## The failure this exists for
 *
 * `fetch` has no default timeout. On this application a request handler runs
 * inside the RLS transaction, holding a pooled PostgreSQL connection, so a call
 * that never returns is a connection that is never released — ten of them and
 * the API stops answering. That happened twice (P142), and the object-store
 * calls that could still do it were found by sweeping for this exact pattern
 * (P143-01), not by anybody noticing.
 *
 * ## What it checks
 *
 * Two rules, because the hazard has two shapes and the first version of this
 * script only caught one of them — which it demonstrated by staying green while
 * `object-storage.ts` was reverted to the exact defect it was written for.
 *
 * 1. **Direct calls.** Every `fetch(` passes a `signal:` in the same argument
 *    list, or is the wrapper itself, or is in ALLOWED with a reason.
 * 2. **Injected defaults.** No `typeof fetch = fetch`. An injectable
 *    `fetchImpl` whose default is a bare `fetch` is how every production
 *    caller ends up unbounded while every test passes its own — and it is not
 *    a call site, so rule 1 cannot see it. This is the shape P143-01 actually
 *    had, six times over.
 *
 * Browser code is excluded: a hung request there costs a spinner, not a
 * database connection. It is still worth fixing and it is P143-04, not this.
 *
 * ## Why a script and not a lint rule
 *
 * It could be one. It is here because `pnpm verify` is what a person runs
 * before pushing and a custom ESLint plugin is a package nobody would maintain
 * — CLAUDE.md §9.11: the check has to live where the work happens.
 *
 * Watched red: reverting `withDeadline()` to `fetch` in `object-storage.ts`
 * reports it.
 */

import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

/** Server-side source. Everything here can hold a database connection. */
const ROOTS = [
  "apps/api/src/**/*.ts",
  "packages/oidc/src/**/*.ts",
  "packages/eiv-client/src/**/*.ts",
  "packages/mail/src/**/*.ts",
];

/**
 * Deliberate exemptions. A file earns a line here by explaining itself; an
 * empty reason is not an exemption, it is an unreviewed hole.
 */
const ALLOWED = new Map([
  [
    "apps/api/src/shared/deadline-fetch.ts",
    "the wrapper itself — it is what attaches the signal",
  ],
]);

const IGNORE = /\.test\.ts$|\/mock\/|\/dist\//u;

/** `fetch(` not preceded by a dot or word character, so `.fetchImpl(` is not one. */
const CALL = /(?<![.\w])fetch\s*\(/gu;

/**
 * `= fetch` as a default, e.g. `private readonly fetchImpl: typeof fetch = fetch,`.
 *
 * Matched on the annotation so that a variable coincidentally named `fetch` is
 * not mistaken for one — the thing being described is always `typeof fetch`.
 */
const DEFAULT_IMPL = /typeof\s+fetch\s*=\s*fetch\b/gu;

let problems = 0;
let checked = 0;
let calls = 0;

for (const pattern of ROOTS) {
  for (const file of globSync(pattern)) {
    if (IGNORE.test(file)) continue;
    checked += 1;

    const raw = readFileSync(file, "utf8");
    /*
     * Comments blanked before matching, offsets preserved.
     *
     * The first version of this reported `shared/media-url.ts:2` — its header
     * says "something a browser can fetch (P10-09)", and `fetch\s*\(` matched
     * the prose. A check whose first finding is a sentence is a check nobody
     * will trust the second time, and on this file the *docs* outnumber the
     * code, so this is not an edge case here.
     */
    const source = blankComments(raw);
    for (const match of source.matchAll(CALL)) {
      calls += 1;
      if (ALLOWED.has(file)) continue;

      /*
       * The call's own argument list, up to the balanced closing paren. A
       * `signal:` anywhere else in the file proves nothing about this call —
       * which is the whole §9.1 trap: a check that matches the file rather
       * than the call is green for the wrong reason.
       */
      if (!hasSignal(source, match.index + match[0].length - 1)) {
        problems += 1;
        const line = raw.slice(0, match.index).split("\n").length;
        console.error(
          `${file}:${String(line)}: fetch() with no signal. ` +
            `Use withDeadline() from shared/deadline-fetch.js, pass an ` +
            `AbortSignal.timeout(...), or add it to ALLOWED with a reason.`,
        );
      }
    }

    if (!ALLOWED.has(file)) {
      for (const match of source.matchAll(DEFAULT_IMPL)) {
        problems += 1;
        const line = raw.slice(0, match.index).split("\n").length;
        console.error(
          `${file}:${String(line)}: an injectable fetch defaulting to a bare ` +
            `fetch(). Every production caller is then unbounded while every ` +
            `test passes its own. Use withDeadline() as the default.`,
        );
      }
    }
  }
}

/**
 * Replace every comment with spaces of the same length.
 *
 * Same length so every reported line number still refers to the real file — a
 * check that names the wrong line is worse than one that names none.
 */
function blankComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/gu, " ");
      i = stop;
    } else if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += source[i];
      i += 1;
    }
  }
  return out;
}

/** True if the argument list starting at `open` contains a `signal:` key. */
function hasSignal(source, open) {
  let depth = 0;
  let i = open;
  for (; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return /\bsignal\s*:/u.test(source.slice(open, i));
}

if (problems > 0) {
  console.error(
    `\ncheck-deadlines: ${String(problems)} outbound call(s) can wait for ever.`,
  );
  process.exit(1);
}

console.log(
  `check-deadlines: ${String(calls)} fetch call(s) in ${String(checked)} server file(s), all bounded`,
);
