/**
 * Every command the documentation tells somebody to run must exist (P181-01).
 *
 * ## The failure this is for
 *
 * CLAUDE.md §11 records three fluent sentences that shipped and were false. One
 * of them was a command:
 *
 *     Run once: `sudo deploy.sh --install-timers`
 *
 * The script's `case` had no such option and answered `unknown option`. Nothing
 * caught it, and nothing could have: `pnpm verify` runs code, and **prose is not
 * executed**. The sentence was read by a person, at the moment they needed it to
 * work, which is the worst possible time to discover it never did.
 *
 * It is CLAUDE.md §9.9's corollary pointed at ourselves. There the lesson is
 * that a setting a document tells a human to apply is a setting that is not
 * applied; here it is that a command a document tells a human to run may not be
 * a command at all. The document is the only thing asserting it exists, and a
 * document asserts with exactly the same confidence whether it is right or
 * wrong.
 *
 * ## What it checks
 *
 * Inside fenced code blocks and inline code spans, in the documents a person
 * reads to *do* something:
 *
 *   * `pnpm <script>` and `pnpm --filter <package> <script>` — the script is
 *     declared by the root `package.json` or by that workspace's own.
 *   * `node scripts/<file>.mjs` and bare `<file>.mjs` — the file is there.
 *   * `<file>.sh --option` — the script is there and the literal `--option`
 *     appears in it, which is what the deploy.sh sentence needed.
 *
 * ## What it deliberately does not read
 *
 * `docs/backlog/`, `docs/adr/` and the changelogs are a **record of what
 * happened**, and a correct entry there may well name a command that was
 * removed afterwards — P96 explains a defect whose cause was `pnpm wp:bundle`,
 * a script that rightly no longer exists. Requiring history to stay runnable
 * would either break the check or, far worse, pressure somebody into editing
 * the history so it passes.
 *
 * That exclusion is the §9.1 trap in this script's own design — a gate that is
 * green because of what it is not scanning — so the floors below fail if the
 * scan collapses to fewer documents or fewer commands than the repository is
 * known to contain.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Floors, so this cannot pass by reading nothing.
 *
 * `check-eiv-settings.mjs` earned these the hard way: it reported success while
 * scanning one config file, because a git pathspec matched a single directory
 * level. A count that only ever goes up is not a floor anybody has to maintain.
 */
const MINIMUM_DOCUMENTS = 40;
const MINIMUM_COMMANDS = 50;

/** Directories that record what was, rather than instruct what to do. */
const HISTORY = [/^docs\/backlog\//u, /^docs\/adr\//u, /CHANGELOG/u];

/**
 * pnpm's own verbs. `pnpm install` is not a script and never will be, so
 * looking for it in `package.json` would report every README as broken.
 */
const PNPM_BUILTINS = new Set([
  "install",
  "i",
  "add",
  "remove",
  "update",
  "up",
  "audit",
  "why",
  "list",
  "ls",
  "outdated",
  "exec",
  "dlx",
  "create",
  "init",
  "link",
  "unlink",
  "import",
  "rebuild",
  "prune",
  "store",
  "fetch",
  "publish",
  "pack",
  "deploy",
  "licenses",
  "patch",
  "setup",
  "env",
  "config",
  "server",
]);

/**
 * Commands a document names **as history**, which are correct to mention and
 * correct not to have.
 *
 * Each entry carries the reason, and a stale one is a failure: an exemption
 * nobody can see is how a check quietly stops covering the thing it was written
 * for. If the sentence goes, the entry has to go with it.
 */
const HISTORIC = [
  {
    file: "wordpress/ds-lms/README.md",
    command: "pnpm wp:bundle",
    why: "Removed by P96-01. The paragraph explains the defect its existence caused.",
  },
];

const problems = [];
const commands = [];

function tracked(pattern) {
  return execSync(`git ls-files -- '${pattern}'`, { cwd: REPO, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((line) => line !== "");
}

/** Package name -> the scripts it declares. */
function workspaceScripts() {
  const byName = new Map();
  for (const file of [
    "package.json",
    ...tracked("*/package.json"),
    ...tracked("*/*/package.json"),
  ]) {
    const path = join(REPO, file);
    if (!existsSync(path)) continue;
    const json = JSON.parse(readFileSync(path, "utf8"));
    if (typeof json.name !== "string") continue;
    byName.set(json.name, new Set(Object.keys(json.scripts ?? {})));
  }
  return byName;
}

/** Basename -> path, for the shell scripts a document may name without one. */
function shellScripts() {
  const byBase = new Map();
  for (const file of tracked("*.sh")) {
    const base = file.split("/").pop();
    if (byBase.has(base)) byBase.set(base, "AMBIGUOUS");
    else byBase.set(base, file);
  }
  return byBase;
}

/** The code a reader would copy: fenced blocks, then inline spans. */
function codeLines(text) {
  const lines = [];
  for (const block of text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/gu)) {
    lines.push(...block[1].split("\n"));
  }
  const prose = text.replace(/```[a-zA-Z]*\n[\s\S]*?```/gu, "");
  for (const span of prose.matchAll(/`([^`\n]+)`/gu)) lines.push(span[1]);
  return lines;
}

const SCRIPTS = workspaceScripts();
const SHELL = shellScripts();
const ROOT_SCRIPTS = SCRIPTS.get("digitalspital-education-platform") ?? new Set();

const exempt = new Set(HISTORIC.map((entry) => `${entry.file}::${entry.command}`));
const exemptUsed = new Set();

function report(file, command, message) {
  const key = `${file}::${command}`;
  if (exempt.has(key)) {
    exemptUsed.add(key);
    return;
  }
  problems.push({ file, command, message });
}

function checkPnpm(file, line) {
  for (const match of line.matchAll(
    /\bpnpm\s+(?:--filter\s+(?<pkg>[@a-zA-Z0-9/._-]+)\s+)?(?:run\s+)?(?<script>[a-z][a-zA-Z0-9:._-]*)/gu,
  )) {
    const pkg = match.groups.pkg;
    const script = match.groups.script;
    if (pkg === undefined && PNPM_BUILTINS.has(script)) continue;
    if (pkg !== undefined && PNPM_BUILTINS.has(script)) continue;

    const command =
      pkg === undefined ? `pnpm ${script}` : `pnpm --filter ${pkg} ${script}`;
    commands.push(command);

    if (pkg === undefined) {
      if (!ROOT_SCRIPTS.has(script)) {
        report(file, command, `no "${script}" script in the root package.json`);
      }
      continue;
    }
    const declared = SCRIPTS.get(pkg);
    if (declared === undefined) {
      report(file, command, `no workspace package named ${pkg}`);
    } else if (!declared.has(script)) {
      report(file, command, `${pkg} declares no "${script}" script`);
    }
  }
}

function checkNodeScript(file, line) {
  for (const match of line.matchAll(
    /\b((?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.mjs)\b/gu,
  )) {
    const named = match[1];
    const candidates = named.includes("/") ? [named] : [join("scripts", named)];
    commands.push(named);
    if (!candidates.some((candidate) => existsSync(join(REPO, candidate)))) {
      report(file, named, `no such file — looked for ${candidates.join(", ")}`);
    }
  }
}

function checkShell(file, line) {
  for (const match of line.matchAll(
    /(?<path>(?:\.\/)?(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.sh)(?<rest>(?:\s+--[a-z][a-z0-9-]*)*)/gu,
  )) {
    // A URL, not a path: `curl -fsSL https://tailscale.com/install.sh`. The
    // repository cannot vouch for somebody else's installer.
    const before = line.slice(0, match.index);
    if (/[a-z][a-z0-9+.-]*:\/\/\S*$/u.test(before)) continue;

    const named = match.groups.path.replace(/^\.\//u, "");
    const options = [...match.groups.rest.matchAll(/--[a-z][a-z0-9-]*/gu)].map(
      (o) => o[0],
    );
    commands.push(named);

    let path = named;
    if (!existsSync(join(REPO, path))) {
      const base = named.split("/").pop();
      const found = SHELL.get(base);
      if (found === undefined) {
        report(file, named, "no such shell script anywhere in the repository");
        continue;
      }
      if (found === "AMBIGUOUS") continue;
      path = found;
    }

    if (options.length === 0) continue;
    const source = readFileSync(join(REPO, path), "utf8");
    for (const option of options) {
      commands.push(`${named} ${option}`);
      // The option has to be handled, not merely mentioned in the usage block:
      // a `case` arm is what makes it do something.
      const handled = new RegExp(`(^|[|\\s(])${option}[)|\\s]`, "mu").test(source);
      if (!handled) {
        report(file, `${named} ${option}`, `${path} does not accept ${option}`);
      }
    }
  }
}

const documents = tracked("*.md").filter(
  (file) => !HISTORY.some((pattern) => pattern.test(file)),
);

for (const file of documents) {
  for (const line of codeLines(readFileSync(join(REPO, file), "utf8"))) {
    checkPnpm(file, line);
    checkNodeScript(file, line);
    checkShell(file, line);
  }
}

for (const entry of HISTORIC) {
  if (!exemptUsed.has(`${entry.file}::${entry.command}`)) {
    problems.push({
      file: entry.file,
      command: entry.command,
      message:
        "this exemption is stale — the document no longer names the command, so delete the entry",
    });
  }
}

if (documents.length < MINIMUM_DOCUMENTS) {
  problems.push({
    file: "scripts/check-docs-commands.mjs",
    command: "the scan itself",
    message: `read ${documents.length} documents, expected at least ${MINIMUM_DOCUMENTS} — the file list is broken, not the docs`,
  });
}
if (commands.length < MINIMUM_COMMANDS) {
  problems.push({
    file: "scripts/check-docs-commands.mjs",
    command: "the scan itself",
    message: `found ${commands.length} commands, expected at least ${MINIMUM_COMMANDS} — the extraction is broken, not the docs`,
  });
}

if (problems.length > 0) {
  console.error("\nCommands the documentation promises, that do not exist:\n");
  for (const problem of problems) {
    console.error(`  ${problem.file}`);
    console.error(`    ${problem.command}  —  ${problem.message}`);
  }
  console.error(
    "\nA reader runs these at the moment they need them to work. Fix the command\n" +
      "or fix the sentence; do not leave a document asserting something untrue.\n",
  );
  process.exit(1);
}

console.log(
  `check:docs-commands — ${String(commands.length)} commands across ${String(documents.length)} documents, all present`,
);
