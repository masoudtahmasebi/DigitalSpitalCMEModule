/**
 * The Node major has one home, and `@types/node` is one of its readers (P251-02).
 *
 * ## The failure this exists for
 *
 * `pnpm outdated` reported `@types/node` 22.20.4 → **26.6.4** and Dependabot is
 * configured to ignore every major, so nothing would ever have raised it — and
 * nothing would have refused it either. Taking it looks like housekeeping. It
 * is not: `@types/node` is not a library this code calls, it is a **description
 * of the runtime this code runs on**. On 26 against a Node 22 container,
 * `pnpm typecheck` goes green on a call to a method that does not exist, and
 * the first anybody hears of it is a `TypeError` in production naming an API
 * that is documented — for a version nobody installed.
 *
 * There is no test that can catch that. A unit test calling the method fails
 * locally too, so it never gets written; a test that does not call it proves
 * nothing. The types *are* the assertion, and a wrong one is silent by
 * construction.
 *
 * ## Why a check and not a sentence
 *
 * The Node major is declared in five mechanical places and read as a sixth:
 *
 * | Declared in | Shape |
 * | --- | --- |
 * | `.nvmrc` | `22` |
 * | `package.json` `engines.node` | `>=22` |
 * | `.github/workflows/*.yml` | `node-version: 22`, or `node-version-file: .nvmrc` |
 * | `Dockerfile` | `FROM node:22-bookworm-slim`, twice |
 * | every `package.json` | `"@types/node": "^22.20.5"` |
 *
 * That is CLAUDE.md §9.10b — one value, six readers — and the quiet direction
 * is the expensive one. §9.9 settles the rest: a line in a README telling the
 * next person to keep six numbers equal is six numbers that will diverge. So
 * `.nvmrc` is the one home and this derives every other reader from it.
 *
 * ## What it checks
 *
 * 1. `.nvmrc` holds a major this script can read.
 * 2. Every `engines.node` in the workspace has that major as its floor.
 * 3. Every workflow `node-version:` literal is that major. A
 *    `node-version-file:` is accepted only when it points at `.nvmrc` — any
 *    other file is a second home.
 * 4. Every `FROM node:<major>` in the Dockerfile is that major.
 * 5. Every `@types/node` range in the workspace has that major.
 *
 * Prose is deliberately **not** checked. `dependabot.yml` and
 * `docs/deployment.md` both mention `node:22-bookworm-slim` in comments, and a
 * stale sentence there misleads a reader without misleading a build. Widening
 * this to prose would mean matching the shape in every document, which is how
 * a check ends up with an exemption list on the day it ships (§9.1).
 *
 * Hand-parsed rather than through a YAML library, for the reason
 * `check-workflow-shell.mjs` gives: a dependency here would be a dependency of
 * `pnpm verify`, and this has to work on a checkout that has not installed.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";

/**
 * Below these, the parser has stopped matching the repository's shape and is
 * reporting success over nothing — §9.1's third form, which is half of what
 * this script is about. The numbers are what the tree held when it was
 * written: 1 engines floor, 5 workflow declarations, 2 `FROM node:` lines and
 * 5 `@types/node` ranges. They are floors, not expectations — raising a count
 * is fine, dropping to zero silently is not.
 */
const MINIMUM = { engines: 1, workflows: 4, docker: 2, types: 4 };

const WORKFLOWS = ".github/workflows";
const DOCKERFILE = "Dockerfile";

/** Workspace manifests, from `pnpm-workspace.yaml`'s two globs plus the root. */
function manifests() {
  const found = ["package.json"];
  for (const group of ["apps", "packages"]) {
    if (!existsSync(group)) continue;
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = `${group}/${entry.name}/package.json`;
      if (existsSync(path)) found.push(path);
    }
  }
  return found;
}

/** The leading major of a version or range: `^22.20.5`, `>=22`, `22` → 22. */
function majorOf(text) {
  const match = /(\d+)/u.exec(String(text));
  return match === null ? undefined : Number(match[1]);
}

const problems = [];
const counted = { engines: 0, workflows: 0, docker: 0, types: 0 };

const runtime = majorOf(readFileSync(".nvmrc", "utf8").trim());
if (runtime === undefined) {
  console.error(
    `check-node-version: .nvmrc does not hold a version this script can read. ` +
      `It is the one home for the Node major and everything else is derived ` +
      `from it, so an unreadable .nvmrc is not a pass.`,
  );
  process.exit(1);
}

for (const path of manifests()) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));

  const engines = manifest.engines?.node;
  if (engines !== undefined) {
    counted.engines += 1;
    const declared = majorOf(engines);
    if (declared !== runtime) {
      problems.push(
        `${path} engines.node is "${engines}" (major ${declared}), ` +
          `but .nvmrc says ${runtime}`,
      );
    }
  }

  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const range = manifest[field]?.["@types/node"];
    if (range === undefined) continue;
    counted.types += 1;
    const declared = majorOf(range);
    if (declared === runtime) continue;
    problems.push(
      `${path} ${field}["@types/node"] is "${range}" (major ${declared}), but ` +
        `the runtime is Node ${runtime}. @types/node describes the runtime: on a ` +
        `different major the typecheck goes green on APIs that are not there.`,
    );
  }
}

for (const name of existsSync(WORKFLOWS) ? readdirSync(WORKFLOWS) : []) {
  if (!/\.ya?ml$/u.test(name)) continue;
  const path = `${WORKFLOWS}/${name}`;
  const text = readFileSync(path, "utf8");

  for (const [, value] of text.matchAll(/^\s*node-version:\s*["']?([^"'\s#]+)/gmu)) {
    counted.workflows += 1;
    const declared = majorOf(value);
    if (declared === runtime) continue;
    problems.push(
      `${path} pins node-version: ${value} (major ${declared}), but .nvmrc ` +
        `says ${runtime}`,
    );
  }

  for (const [, value] of text.matchAll(/^\s*node-version-file:\s*["']?([^"'\s#]+)/gmu)) {
    counted.workflows += 1;
    if (value === ".nvmrc") continue;
    problems.push(
      `${path} reads node-version-file: ${value}, which is a second home for ` +
        `the Node major. Point it at .nvmrc.`,
    );
  }
}

if (existsSync(DOCKERFILE)) {
  const text = readFileSync(DOCKERFILE, "utf8");
  for (const [, value] of text.matchAll(/^FROM\s+node:(\S+)/gmu)) {
    counted.docker += 1;
    const declared = majorOf(value);
    if (declared === runtime) continue;
    problems.push(
      `${DOCKERFILE} builds on node:${value} (major ${declared}), but .nvmrc ` +
        `says ${runtime} — the image is the runtime, so this one is not a warning`,
    );
  }
}

const thin = Object.entries(MINIMUM).filter(([key, floor]) => counted[key] < floor);
if (thin.length > 0) {
  for (const [key, floor] of thin) {
    console.error(
      `check-node-version: found ${counted[key]} ${key} declaration(s), expected ` +
        `at least ${floor}. The parser has stopped matching the repository — fix ` +
        `it rather than lowering the floor.`,
    );
  }
  process.exit(1);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-node-version: ${problem}`);
  process.exit(1);
}

console.log(
  `check-node-version: Node ${runtime} from .nvmrc, agreed by ` +
    `${counted.engines} engines floor(s), ${counted.workflows} workflow ` +
    `declaration(s), ${counted.docker} image(s) and ${counted.types} ` +
    `@types/node range(s)`,
);
