/**
 * Every value a container refuses to start without is one the deploy supplies
 * (P44-02).
 *
 * ## The failure this exists to catch
 *
 * `infra/nginx/ds-runtime-config.sh` runs at container start for the admin
 * console and the portal, and exits 1 when a `required` value is empty — by
 * design, because the alternative is a frontend that loads and then fails every
 * request. It required `DS_PROJECT_SLUG`.
 *
 * Nothing supplied `DS_PROJECT_SLUG`. Not `docker-compose.prod.yml`, which
 * gives those two services exactly one variable each; not `config.env.example`;
 * not `domains.sh`. So both containers exited 1 on every start, for months,
 * and the deploy reported:
 *
 * ```
 * ✘ Container ds-education-api-1  Error
 * dependency failed to start: container ds-education-api-1 is unhealthy
 * ```
 *
 * — naming the API, because `caddy` depends on all of them and the API is the
 * one with a healthcheck. Two containers in a restart loop, and the error names
 * a third.
 *
 * ## Why a script and not a test
 *
 * The two facts live in different languages and different files: a `required`
 * marker in a POSIX shell script, and an `environment:` block in YAML. Nothing
 * in either can see the other, which is exactly the shape CLAUDE.md §9.11 says
 * belongs in `scripts/` — the question is mechanical and the answer was
 * previously "somebody notices when a container will not start".
 *
 * Run by `pnpm verify` and by CI.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENTRYPOINT = join(REPO, "infra/nginx/ds-runtime-config.sh");
const COMPOSE = join(REPO, "infra/deploy/docker-compose.prod.yml");

/** The services whose image runs `ds-runtime-config.sh`. */
const SERVICES = ["admin", "portal"];

const problems = [];

/**
 * The environment variables the entrypoint refuses to start without.
 *
 * Parsed from the `emit` calls rather than listed here, because a list here is
 * a second place to write the same thing and would go stale the same way the
 * missing variable did. `emit <name> "${VAR:-}" required`.
 */
function requiredVariables() {
  const source = readFileSync(ENTRYPOINT, "utf8");
  const found = [];
  const pattern = /^\s*emit\s+\S+\s+"\$\{(\w+):-\}"\s+(required|optional)\s*$/gmu;

  for (const match of source.matchAll(pattern)) {
    if (match[2] === "required") found.push(match[1]);
  }

  if (found.length === 0) {
    // Not "nothing is required, all good": the regex and the script have
    // drifted, and a check that silently stops checking is the failure mode
    // CLAUDE.md §9.1 is entirely about.
    problems.push(
      `${ENTRYPOINT}: found no \`emit … required\` lines at all. Either every ` +
        "value became optional (in which case delete this check and say why), " +
        "or the parser no longer matches the script's syntax.",
    );
  }

  return found;
}

/**
 * Which variables a service's `environment:` block sets.
 *
 * A deliberately small YAML reader: the block is `KEY: value` at a fixed
 * indentation under a known service, and pulling in a YAML dependency for a
 * question this shape is more surface than the question is worth. It fails
 * loudly if it cannot find the service at all, so a rename cannot make it
 * silently pass.
 */
function serviceEnvironment(service) {
  const source = readFileSync(COMPOSE, "utf8");
  const lines = source.split("\n");

  const start = lines.findIndex((line) => line === `  ${service}:`);
  if (start === -1) {
    problems.push(`${COMPOSE}: no service named \`${service}\``);
    return new Set();
  }

  const names = new Set();
  let inEnvironment = false;

  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/u.test(line)) break; // the next service
    if (/^ {4}environment:\s*$/u.test(line)) {
      inEnvironment = true;
      continue;
    }
    if (inEnvironment && /^ {4}\S/u.test(line)) inEnvironment = false;
    if (!inEnvironment) continue;

    const key = /^ {6}([A-Za-z_][A-Za-z0-9_]*):/u.exec(line);
    if (key) names.add(key[1]);
  }

  return names;
}

const required = requiredVariables();

for (const service of SERVICES) {
  const provided = serviceEnvironment(service);
  for (const variable of required) {
    if (!provided.has(variable)) {
      problems.push(
        `service \`${service}\` does not set ${variable}, which ` +
          "ds-runtime-config.sh requires — the container will exit 1 at start, " +
          "and because caddy depends on it the deploy will report a different " +
          "service as the failure.",
      );
    }
  }
}

if (problems.length > 0) {
  console.error("check-runtime-config: the deploy cannot start these containers\n");
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  console.error(
    "\nEither set the variable in infra/deploy/docker-compose.prod.yml (and " +
      "derive it in domains.sh, and document it in config.env.example), or " +
      "make it `optional` in the entrypoint if nothing reads it any more.",
  );
  process.exit(1);
}

console.log(
  `check-runtime-config: ${String(required.length)} required value(s), ` +
    `provided by all ${String(SERVICES.length)} service(s)`,
);
