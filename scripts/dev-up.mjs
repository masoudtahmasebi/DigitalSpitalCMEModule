/**
 * A clean checkout to a running, seeded, signed-in-able stack, in one command
 * (P44-04).
 *
 * ## Why this exists
 *
 * Local development was five commands and one undocumented step. The README
 * said `pnpm install`, `pnpm infra:up`, `pnpm db:dev:reset`, `pnpm dev` — and
 * omitted `cp .env.example .env`, without which the API reads no database URL
 * at all. Then, having got that far, there was still no console account:
 * `bootstrap-admin` is a separate command mentioned two sections further down.
 *
 * Every one of those is easy once you know it. The cost is not the typing, it
 * is that a failure anywhere in the chain looks like "the project is broken"
 * rather than "step three of five has not been run" — which is the same
 * confusion, one machine over, that CLAUDE.md §9.9 keeps recording about the
 * server.
 *
 *   pnpm start          set everything up, then say what to open
 *   pnpm start --keep   the same, without dropping the database
 *
 * Then `pnpm dev`.
 *
 * ## What it deliberately does not do
 *
 * Start the app servers. `pnpm dev` is a long-running foreground process with
 * three watchers in it, and a setup script that ends by never returning is a
 * script nobody can put in a chain. This one finishes, prints what it made, and
 * hands over.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const keep = process.argv.includes("--keep");

const BOLD = "[1m";
const DIM = "[2m";
const RED = "[1;31m";
const GREEN = "[1;32m";
const OFF = "[0m";

let step = 0;
function heading(what) {
  step += 1;
  console.log(`\n${BOLD}${step}. ${what}${OFF}`);
}

function die(message) {
  console.error(`\n${RED}✘${OFF} ${message}\n`);
  process.exit(1);
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) die(`\`${command} ${args.join(" ")}\` failed — see above.`);
}

// ---------------------------------------------------------------------------
// 1. The tools this needs, named individually
// ---------------------------------------------------------------------------
//
// One message per missing tool, with what to do about it. A single "check your
// prerequisites" is a message that makes the reader audit four things to find
// the one that is wrong.
heading("Checking prerequisites");

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  die(
    `Node ${process.versions.node} — this workspace needs 22 (see .nvmrc).\n` +
      "   With nvm:  nvm install && nvm use",
  );
}

if (spawnSync("docker", ["--version"], { stdio: "ignore" }).status !== 0) {
  die(
    "docker is not installed. Postgres, Redis, Keycloak and Mailpit all run in\n" +
      "   containers — https://docs.docker.com/get-docker/",
  );
}

// `docker --version` answers from the client alone, so it succeeds while the
// daemon is stopped — the single most common state of a laptop that has just
// booted, and one that otherwise surfaces four lines later as an incoherent
// compose error.
if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
  die(
    "the docker daemon is not running. Start Docker Desktop (or `sudo systemctl start docker`).",
  );
}

if (spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status !== 0) {
  die("docker compose v2 is not available (`docker compose version` fails).");
}

if (!existsSync(join(REPO, "node_modules"))) {
  die("dependencies are not installed. Run: pnpm install");
}

console.log(`   ${GREEN}✓${OFF} node ${process.versions.node}, docker, pnpm workspace`);

// ---------------------------------------------------------------------------
// 2. .env — the step that was missing from the README
// ---------------------------------------------------------------------------
heading("Local configuration (.env)");

const envPath = join(REPO, ".env");
if (existsSync(envPath)) {
  console.log(`   ${GREEN}✓${OFF} .env exists — left exactly as it is`);
} else {
  copyFileSync(join(REPO, ".env.example"), envPath);
  console.log(`   ${GREEN}✓${OFF} copied .env.example → .env`);
}

// `SECRETS_KMS_KEY` encrypts the VNR password and the SMTP credentials at rest
// (CLAUDE.md §4 invariant 7). Development may run without it — the cipher falls
// back to plaintext and production refuses to start that way — but a developer
// who never has one also never exercises the encrypted path, and finds out on
// the server. Generated here so the local stack behaves like the real one.
const envText = readFileSync(envPath, "utf8");
if (/^SECRETS_KMS_KEY=\s*$/mu.test(envText)) {
  writeFileSync(
    envPath,
    envText.replace(
      /^SECRETS_KMS_KEY=\s*$/mu,
      `SECRETS_KMS_KEY=${randomBytes(32).toString("base64")}`,
    ),
  );
  console.log(
    `   ${GREEN}✓${OFF} generated SECRETS_KMS_KEY (local only, never committed)`,
  );
}

// ---------------------------------------------------------------------------
// 3. Containers
// ---------------------------------------------------------------------------
heading("Starting Postgres, Redis, Keycloak and Mailpit");
run("pnpm", ["infra:up"]);

// ---------------------------------------------------------------------------
// 4. Schema and data
// ---------------------------------------------------------------------------
//
// All three tenants, through `packages/seed` — the same code the deploy runs,
// so a developer's database and a fresh installation cannot drift. The portal
// takes its tenant from the URL path, so `/medice` and `/ds` are only
// exercisable when both exist.
heading(
  keep ? "Migrating and seeding (keeping existing data)" : "Rebuilding the database",
);
run("node", [join(REPO, "scripts/devdb.mjs"), ...(keep ? ["--keep"] : [])]);

// ---------------------------------------------------------------------------
// 5. A console account
// ---------------------------------------------------------------------------
//
// `bootstrap-admin` refuses while an active super administrator exists, so this
// is a no-op on a `--keep` run that already has one. Its own output carries the
// password, printed exactly once.
heading("Console super administrator");
const bootstrap = spawnSync(
  "pnpm",
  ["--filter", "@ds/api", "exec", "node", "dist/bootstrap-admin.js"],
  { cwd: REPO, encoding: "utf8", env: process.env },
);
const bootstrapOutput = `${bootstrap.stdout ?? ""}${bootstrap.stderr ?? ""}`.trim();
if (bootstrap.status === 0) {
  console.log(bootstrapOutput.replace(/^/gmu, "   "));
} else {
  // Not fatal: the overwhelmingly likely reason is that one already exists,
  // which is a correct refusal (P38-03) and not a broken setup.
  console.log(
    `   ${DIM}${bootstrapOutput.split("\n").pop() ?? "already bootstrapped"}${OFF}`,
  );
  console.log(
    `   ${DIM}(an active super administrator already exists — that is the refusal working)${OFF}`,
  );
}

// ---------------------------------------------------------------------------
// What to open
// ---------------------------------------------------------------------------
console.log(
  [
    "",
    `${GREEN}Ready.${OFF} Start the app servers with ${BOLD}pnpm dev${OFF}, then:`,
    "",
    `  ${BOLD}http://localhost:5174${OFF}              the admin console`,
    `  ${BOLD}http://localhost:5175/medice${OFF}       the learner portal, MEDICE's tenant`,
    `  ${BOLD}http://localhost:5175/ds${OFF}           the learner portal, the DS test tenant`,
    `  ${BOLD}http://localhost:5175/dsproject${OFF}    the neutral default tenant`,
    `  ${BOLD}http://localhost:5173${OFF}              the widget on its own`,
    `  ${BOLD}http://localhost:3000/health${OFF}       the API`,
    `  ${BOLD}http://localhost:8025${OFF}              Mailpit — every email the platform sends`,
    "",
    `${DIM}Participant passwords were printed by the seeds above. Set SEED_PARTICIPANT_PASSWORD`,
    `to pin one across re-runs. Forgot-password lands in Mailpit, not a real inbox.${OFF}`,
    "",
    `${DIM}Reset and start again:  pnpm start`,
    `Keep the data:          pnpm start --keep${OFF}`,
    "",
  ].join("\n"),
);
