/**
 * Every design token a screen reads is defined, and the admin's are its own.
 *
 * ## The two defects this closes
 *
 * **1. A token read and never defined renders as nothing.**
 * `--ds-surface-sunken` was referenced twice — `MediaThumbnail`'s frame and
 * `MediaDialog`'s drag-over tint — from P88-01 (17.08) and defined nowhere.
 * An unresolved custom property with no fallback makes the whole declaration
 * invalid at computed-value time, so `background-color` fell back to
 * `transparent`. Measured in Chromium:
 *
 *     defined    -> rgb(233, 233, 231)
 *     undefined  -> rgba(0, 0, 0, 0)      <- what shipped
 *     fallback   -> rgb(220, 220, 218)
 *
 * Nothing failed. Tailwind emits `background-color: var(--ds-surface-sunken)`
 * for any name at all — the arbitrary-value syntax is a string, so there is no
 * spelling it can reject — the browser drops the declaration silently, and the
 * screen looks like a thumbnail frame somebody had not styled yet. It is §9.3:
 * a rule written (the token, at its read site) and never enforced (a value).
 *
 * **2. Nothing distinguished a shared token from the console's own.**
 * `--ds-brand-*` is written at runtime by `brandingCssVars` in `@ds/domain`
 * from a customer's project settings, and rendered by the learner widget.
 * `--ds-ink`, `--ds-surface`, `--ds-hairline` were the admin console's alone —
 * and at a call site the two are typographically identical. So a console
 * author inventing a neutral, and a branding author adding a customer-settable
 * colour, were writing into one namespace by two different sets of rules, and
 * which rules applied to a given name was knowable only by grepping.
 *
 * The review's Package A asked for this as `--ds-admin-*`, and the prefix is
 * what makes the boundary checkable rather than conventional. The rule this
 * script enforces, in both directions:
 *
 *   - a `--ds-admin-*` token is defined in the admin's stylesheet, and is read
 *     by the admin console and by nothing else;
 *   - a bare `--ds-*` token is shared: declared with a fallback in the Tailwind
 *     preset, or written by `@ds/domain`. The console may **override** one and
 *     may never **invent** one.
 *
 * Which is the review's acceptance criterion — *"admin token changes must not
 * alter widget screenshots"* — proved at the source rather than by diffing
 * pictures: an admin token change is, by the rule above, a change to something
 * the widget does not read and the shared preset does not declare.
 *
 * ## Why a script and not a test
 *
 * The question spans four files that no single test renders: a CSS file, a
 * Tailwind preset, a pure module in `@ds/domain`, and 40-odd components. A
 * component test renders one screen against a jsdom that has no cascade and
 * would report a transparent background as a pass.
 */

import { globSync, readFileSync } from "node:fs";

const ADMIN_CSS = "apps/admin/src/styles.css";
const PRESET = "packages/config/tailwind.preset.js";
const ADMIN_PREFIX = "--ds-admin-";

/**
 * Source with its comments removed.
 *
 * Third time this has been needed, and the reason is in `screen-intros.mjs`:
 * a checker that greps source is reading the explanation as well as the code,
 * and the explanation is where the banned thing is most likely to be named.
 * This file's own header quotes `--ds-surface-sunken` half a dozen times.
 *
 * CSS has no `//` comments, and a `//` inside a `url()` is not a comment
 * either, so only the block form is stripped from a stylesheet.
 *
 * A comment is replaced by **as many spaces and newlines as it occupied**,
 * never by one space. Collapsing it shifts every line and column after it, and
 * the first sabotage run reported `MediaCard.tsx:104` for a read on line 171 —
 * a correct finding pointing at the wrong place, which is the sort of thing
 * that gets a checker distrusted rather than read (§9.4).
 */
function code(source, { lineComments = true } = {}) {
  const blank = (match) => match.replace(/[^\n]/g, " ");
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, blank);
  return lineComments ? withoutBlocks.replace(/\/\/[^\n]*/g, blank) : withoutBlocks;
}

/** Every `--ds-…` name that appears, in order, with its line number. */
function tokensIn(source, pattern) {
  const found = [];
  for (const match of source.matchAll(pattern)) {
    found.push({
      name: match[1],
      line: source.slice(0, match.index).split("\n").length,
    });
  }
  return found;
}

const DEFINITION = /(--ds-[a-z0-9-]+)\s*:/g;
/** A read *with a fallback* is self-sufficient, so it is deliberately excluded. */
const READ_WITHOUT_FALLBACK = /var\(\s*(--ds-[a-z0-9-]+)\s*\)/g;
const ANY_READ = /var\(\s*(--ds-[a-z0-9-]+)\s*[,)]/g;

const adminCss = code(readFileSync(ADMIN_CSS, "utf8"), { lineComments: false });
const defined = new Set(tokensIn(adminCss, DEFINITION).map((t) => t.name));

/*
 * The shared namespace has two homes and both count as a definition: the
 * preset's `var(--x, fallback)` declares a default, and `@ds/domain` writes the
 * variable at runtime on a learner surface.
 */
const presetSource = code(readFileSync(PRESET, "utf8"));
for (const { name } of tokensIn(presetSource, ANY_READ)) defined.add(name);
for (const file of globSync("packages/*/src/**/*.ts")) {
  if (file.includes(".test.")) continue;
  for (const { name } of tokensIn(code(readFileSync(file, "utf8")), DEFINITION)) {
    defined.add(name);
  }
}

if (defined.size === 0) {
  console.error(
    "check-design-tokens: found no token definitions at all, so this run " +
      "proves nothing. The stylesheet or the preset moved.",
  );
  process.exit(1);
}

const apps = ["admin", "widget", "portal"];
const sources = [];
for (const app of apps) {
  for (const file of globSync(`apps/${app}/src/**/*.{ts,tsx,css}`)) {
    if (file.includes(".test.")) continue;
    const raw = readFileSync(file, "utf8");
    sources.push({
      app,
      file,
      text: code(raw, { lineComments: !file.endsWith(".css") }),
    });
  }
}

if (sources.length === 0) {
  console.error("check-design-tokens: matched no source files. The tree moved.");
  process.exit(1);
}

const problems = [];
let reads = 0;

for (const { app, file, text } of sources) {
  for (const { name, line } of tokensIn(text, READ_WITHOUT_FALLBACK)) {
    reads += 1;
    if (!defined.has(name)) {
      problems.push(
        `${file}:${line}: reads ${name}, which is defined nowhere and has no ` +
          "fallback — the declaration is invalid at computed-value time and " +
          "the property renders as if it had never been set.",
      );
    }
  }
  for (const { name, line } of tokensIn(text, ANY_READ)) {
    if (name.startsWith(ADMIN_PREFIX) && app !== "admin") {
      problems.push(
        `${file}:${line}: the ${app} reads ${name}, which is the admin ` +
          "console's own namespace. A token only one app defines must not be " +
          "read by another, or a console change moves a learner's pixels.",
      );
    }
  }
}

/*
 * The other direction, and the one that catches the next `--ds-surface-sunken`:
 * a token the admin stylesheet defines outside its own prefix is either a
 * deliberate override of a shared token — which must already exist — or an
 * invention wearing the shared namespace's clothes.
 */
for (const { name, line } of tokensIn(adminCss, DEFINITION)) {
  if (name.startsWith(ADMIN_PREFIX)) continue;
  if (presetSource.includes(name)) continue;
  problems.push(
    `${ADMIN_CSS}:${line}: defines ${name} in the shared \`--ds-*\` namespace, ` +
      `but the preset does not declare it. Either it is the console's own — ` +
      `name it \`${name.replace("--ds-", ADMIN_PREFIX)}\` — or it belongs in ` +
      "the preset with a fallback so the widget has one too.",
  );
}

if (problems.length > 0) {
  console.error("check-design-tokens: " + problems.length + " problem(s)\n");
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}

console.log(
  `check-design-tokens: ${defined.size} token(s) defined, ${reads} ` +
    `fallback-less read(s) across ${sources.length} file(s) in ${apps.length} ` +
    "app(s); every read resolves and the admin namespace does not cross over.",
);
