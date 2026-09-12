/**
 * A control that starts a write is shut while that write is in flight.
 *
 * ## The defect
 *
 * `useSaver` has predicted this since P9-02, in its own header:
 *
 *   > Written out per screen that is six copies of the same `setBusy(true) /
 *   > try / catch / finally` — and the copies drift: one forgets to clear the
 *   > previous error, **one leaves the button enabled during the request and
 *   > double-submits**, one shows "gespeichert" after a failure. So it lives
 *   > here once.
 *
 * It did not live there once — seven components used the hook and six
 * hand-rolled the triplet — and the prediction came true twice on the same
 * screen, both times on a write that touches a person's record:
 *
 * | Handler                 | What a second request does                              |
 * | ----------------------- | ------------------------------------------------------- |
 * | `Learners.correct`      | a second `learner.name_corrected` row in an append-only audit log |
 * | `Learners.erase`        | GDPR Art. 17: the second 404s, so the screen reports a failure for an erasure that succeeded |
 * | `Security.save`         | `auth`: two policies in flight, and network ordering decides which wins |
 *
 * The sentence "so it lives here once" is why nobody looked — §11.9, a comment
 * is a claim rather than a fact.
 *
 * ## What it checks
 *
 * A function that awaits an `admin…` mutation must track in-flight state:
 * `saver.run(...)` from `useSaver`, or a `setBusy`-shaped flag of its own.
 *
 * ## What it deliberately does not flag, and why that matters more
 *
 * **A handler reached only through `ConfirmButton`.** That component calls
 * `setArmed(false)` *before* `props.onConfirm()`, so the confirm button leaves
 * the tree on the first click and React — which flushes a click synchronously
 * — has re-rendered before a second click can be dispatched. The two-step
 * confirm is the guard.
 *
 * This exemption is not tidiness. The first draft of this check did not have
 * it and reported **five** handlers, of which **two were false** —
 * `Security.removeOwn` and `Customers.remove`, both behind `ConfirmButton`.
 * Two in five is the rate at which a checker stops being read (P227-01 taught
 * the same lesson with three false accessible-name findings), and one of the
 * two was nearly "fixed" before the call site was checked.
 *
 * So: a handler is exempt only if **every** call site reaching it is a
 * `ConfirmButton`'s `onConfirm`. A handler with one guarded call site and one
 * bare `<Button onClick>` — which is exactly `Learners.erase`, a plain button
 * inside a hand-rolled two-step — is still reported.
 */

import { globSync, readFileSync } from "node:fs";

const MUTATION =
  /client\.(admin(?:Set|Update|Create|Delete|Remove|Clear|Add|Merge|Reset|Issue|Retry|Requeue|Send|Publish|Unpublish|Move|Import|Invite|Revoke|Mark|Queue|Correct|Withdraw|Erase|Reorder|Rename)[A-Za-z0-9]*)\s*\(/g;

/** `saver.run(`, or a flag a screen sets itself. */
const IN_FLIGHT =
  /\b[A-Za-z0-9_]*\.run\s*\(|\bset(?:Busy|Pending|Saving|Working|Running|Submitting)\s*\(/;

/**
 * Comments replaced by as many spaces and newlines as they occupied.
 *
 * Collapsing them shifts every reported line and column (P228-03), and this
 * file's own header names three of the handlers it looks for.
 */
function code(source) {
  const blank = (match) => match.replace(/[^\n]/g, " ");
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

/** The brace-balanced block that starts at the first `{` after `from`. */
function block(source, from) {
  const open = source.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return { open, close: i, text: source.slice(open, i + 1) };
    }
  }
  return null;
}

/** Every named `function` declaration in `source`, innermost last. */
function functions(source) {
  const found = [];
  for (const match of source.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g)) {
    const body = block(source, match.index);
    if (body !== null) found.push({ name: match[1], at: match.index, body });
  }
  return found;
}

/**
 * The character ranges spanned by every `<ConfirmButton …>` element.
 *
 * The first version of this asked "is there a `<ConfirmButton` within 400
 * characters behind the call site", which is the kind of window that works on
 * the file it was written against and nowhere else. `Customers.tsx` puts
 * eleven lines of props between the tag and `onConfirm`, the window missed it,
 * and the checker reported a handler that is correctly guarded — the same
 * false positive it had just been given an exemption to avoid.
 *
 * So the element is matched rather than guessed: from `<ConfirmButton` to the
 * `>` that closes its opening tag, tracking brace depth so a `>` inside
 * `{a > b}` or inside a nested arrow function does not end it early.
 */
function confirmButtonRanges(source) {
  const ranges = [];
  for (const tag of source.matchAll(/<ConfirmButton\b/g)) {
    let depth = 0;
    for (let i = tag.index; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        ranges.push([tag.index, i]);
        break;
      }
    }
  }
  return ranges;
}

/**
 * Whether every call site of `name` is inside a `<ConfirmButton>`'s props.
 *
 * Deliberately conservative in the direction that reports rather than hides: a
 * handler with no call site at all in this file is **not** exempt, because a
 * handler reached some way this parser cannot see is a handler nobody has
 * checked.
 */
function alwaysConfirmed(source, name, ranges) {
  const sites = [...source.matchAll(new RegExp(`\\b${name}\\s*\\(`, "g"))].filter(
    (site) =>
      !/function\s+$/.test(source.slice(Math.max(0, site.index - 20), site.index)),
  );
  if (sites.length === 0) return false;
  return sites.every((site) =>
    ranges.some(([from, to]) => site.index > from && site.index < to),
  );
}

const files = globSync("apps/admin/src/**/*.tsx").filter((f) => !f.includes(".test."));
if (files.length === 0) {
  console.error("check-savers: matched no component files. The tree moved.");
  process.exit(1);
}

const problems = [];
let handlers = 0;
let exempt = 0;

for (const file of files) {
  const source = code(readFileSync(file, "utf8"));
  const confirmed = confirmButtonRanges(source);
  for (const fn of functions(source)) {
    MUTATION.lastIndex = 0;
    const mutations = [...fn.body.text.matchAll(MUTATION)].map((m) => m[1]);
    if (mutations.length === 0) continue;
    // Only the innermost function holding the call, so a component body that
    // contains its own handlers is not reported alongside them.
    if (functions(fn.body.text.slice(1)).some((inner) => MUTATION.test(inner.body.text)))
      continue;
    handlers += 1;
    if (IN_FLIGHT.test(fn.body.text)) continue;
    if (alwaysConfirmed(source, fn.name, confirmed)) {
      exempt += 1;
      continue;
    }
    const line = source.slice(0, fn.at).split("\n").length;
    problems.push(
      `${file}:${line}: \`${fn.name}()\` awaits ${[...new Set(mutations)].join(", ")} ` +
        "and tracks no in-flight state, so its control stays live for the whole " +
        "round trip and a second click sends a second write. Use `useSaver` " +
        '(`saver.state === "saving"` disables the control), or reach it only ' +
        "through a `ConfirmButton`.",
    );
  }
}

if (problems.length > 0) {
  console.error(`check-savers: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}

console.log(
  `check-savers: ${handlers} mutation handler(s) across ${files.length} ` +
    `component file(s); every one guards its control, ${exempt} of them by a ` +
    "two-step ConfirmButton.",
);
