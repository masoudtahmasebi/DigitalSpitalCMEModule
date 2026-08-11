/**
 * The local stack's ports are one block, and the browser-facing ones agree
 * (P48-02).
 *
 * ## The two mistakes this catches
 *
 * **A port outside the block.** `infra/docker-compose.apps.yml` publishes every
 * service on `localhost:5539x` so there is one range to remember and nothing
 * else on a laptop is sitting there. A service added later with `- "3000:3000"`
 * would work on the machine it was added on and collide on the next one, which
 * is the sort of defect that arrives as "it works for me".
 *
 * **A browser-facing URL naming a container.** This is the one that costs an
 * afternoon. Inside the compose network the services reach each other as
 * `api:3000`; the *browser* can only reach the published port. `DS_API_BASE` is
 * read by `ds-runtime-config.sh` and written into `/config.js`, so it is
 * browser-facing and must say `localhost:55390`. `ALLOWED_ORIGINS` is the
 * mirror: the API has to allow the origins a browser actually sends, which are
 * the published frontend ports.
 *
 * Get either wrong and every request fails CORS — a browser-side failure with
 * **no server-side trace at all**, which is exactly how the `CORS_ALLOWED_ORIGINS`
 * misnaming survived in `docker-compose.prod.yml` until somebody clicked.
 *
 * Run by `pnpm verify` and by CI.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = join(REPO, "infra/docker-compose.apps.yml");

/** The block. Five digits, ephemeral, and nothing standard lives here. */
const BLOCK_LOW = 55390;
const BLOCK_HIGH = 55399;

const source = readFileSync(COMPOSE, "utf8");
const problems = [];

// ---------------------------------------------------------------------------
// Every published port sits in the block, and no two share one
// ---------------------------------------------------------------------------
//
// The default in `${VAR:-55391}` is what an operator who sets nothing gets, and
// it is therefore the value worth checking. A deployment that overrides one is
// making a deliberate choice this cannot second-guess.
const published = [...source.matchAll(/^\s+- "\$\{[A-Z_]+:-(\d+)\}:\d+"/gmu)].map((m) =>
  Number(m[1]),
);

if (published.length === 0) {
  // Not "no ports, nothing to check": the pattern and the file have drifted,
  // and a check that silently stops checking is CLAUDE.md §9.1's whole subject.
  problems.push(
    `${COMPOSE}: found no published ports at all. Either the file stopped ` +
      "publishing any (in which case delete this check and say why), or the " +
      "pattern no longer matches how they are written.",
  );
}

for (const port of published) {
  if (port < BLOCK_LOW || port > BLOCK_HIGH) {
    problems.push(
      `port ${String(port)} is outside ${String(BLOCK_LOW)}–${String(BLOCK_HIGH)}. ` +
        "The local stack is one block so there is one range to remember and " +
        "nothing standard to collide with.",
    );
  }
}

const duplicates = published.filter((port, index) => published.indexOf(port) !== index);
for (const port of new Set(duplicates)) {
  problems.push(
    `port ${String(port)} is published twice — compose will fail with "port is ` +
      'already allocated" and name only one of the two services.',
  );
}

// ---------------------------------------------------------------------------
// The browser-facing values point at published ports, not at service names
// ---------------------------------------------------------------------------
const apiPort = /\$\{DS_LOCAL_API_PORT:-(\d+)\}:3000/u.exec(source)?.[1];
if (apiPort === undefined) {
  problems.push(`${COMPOSE}: could not find the API's published port`);
} else {
  // `DS_API_BASE` reaches a browser through /config.js. `api:3000` is correct
  // for a container and meaningless to Chrome.
  for (const [, value] of source.matchAll(/^\s+DS_API_BASE:\s*(\S+)/gmu)) {
    if (!value.includes("localhost")) {
      problems.push(
        `DS_API_BASE is "${value}", which a browser cannot resolve. It is ` +
          "written into /config.js and fetched by the page, so it must be the " +
          `published port: http://localhost:${apiPort}`,
      );
    }
  }

  // And the API must allow the origins the browser will actually send.
  const origins = /^\s+ALLOWED_ORIGINS:\s*(\S+)/mu.exec(source)?.[1];
  if (origins === undefined) {
    problems.push(`${COMPOSE}: the api service sets no ALLOWED_ORIGINS`);
  } else {
    for (const [name, variable] of [
      ["admin console", "DS_LOCAL_ADMIN_PORT"],
      ["portal", "DS_LOCAL_PORTAL_PORT"],
    ]) {
      if (!origins.includes(variable)) {
        problems.push(
          `ALLOWED_ORIGINS does not include the ${name}'s origin (${variable}). ` +
            "Every request from it will fail CORS, in the browser, with nothing " +
            "in the API log to find.",
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("check-local-ports: the local stack's ports do not hold together\n");
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  console.error(`\nSee the port table at the top of ${COMPOSE}.`);
  process.exit(1);
}

console.log(
  `check-local-ports: ${String(published.length)} port(s), all in ` +
    `${String(BLOCK_LOW)}–${String(BLOCK_HIGH)}, browser-facing URLs agree`,
);
