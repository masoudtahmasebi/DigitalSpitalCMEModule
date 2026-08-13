/**
 * A container that calls out is on a network with a gateway (P70-02).
 *
 * ## The failure this exists to catch
 *
 * `docker-compose.prod.yml` declares two networks:
 *
 * ```yaml
 * networks:
 *   edge:
 *   internal:
 *     internal: true
 * ```
 *
 * `internal: true` is usually read as "nothing outside can reach this", which
 * is true and is half of it. Docker gives an internal network **no gateway**,
 * so a container attached only to it cannot open an outbound connection
 * either — no DNS, no HTTPS, nothing.
 *
 * The `api` service was on `[internal]` alone. It is the service that HEADs an
 * uploaded object, archives a certificate to the bucket, delivers a
 * certificate over SMTP, fetches a customer's Keycloak JWKS to validate every
 * learner token, and reports a Punktemeldung to EIV-FOBI. None of those had
 * ever succeeded on the installation, and none of them says so anywhere a
 * person looks: each surfaces as a timeout, a retry, or Node's magnificently
 * unhelpful `fetch failed` inside a worker.
 *
 * It went unnoticed for months because every one of those paths is either
 * asynchronous, retried, or had never been exercised end-to-end — and because
 * `backup`, the one service somebody *had* traced an S3 failure through,
 * already carried `[internal, edge]`. The fix was applied to the service in
 * front of the person and not to the class.
 *
 * ## Why a script rather than a test
 *
 * The two halves of the question live in different places and neither can see
 * the other: *which hosts does this code talk to* is a fact about TypeScript,
 * and *which networks is this service on* is a fact about YAML. Nothing type-
 * checks across that gap, and the runtime symptom is a timeout in a background
 * worker. CLAUDE.md §9.11 — the question is mechanical, so it belongs here
 * rather than in somebody noticing.
 *
 * This is the static half. The runtime half is `dist/bucket-cors.js`, which the
 * deploy runs and which found this defect on production; the two catch it at
 * different times and neither replaces the other.
 *
 * Run by `pnpm verify` and by CI.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = join(REPO, "infra/deploy/docker-compose.prod.yml");

/**
 * Every service, and whether it must be able to reach the internet.
 *
 * Written out rather than inferred, because "does this call out?" is not
 * derivable from the compose file — it is a fact about what the image does. A
 * service missing from this table fails the check: a new service is exactly
 * when somebody has to answer this question, and the worst outcome is that it
 * is never asked.
 */
const EGRESS = {
  caddy: {
    needed: true,
    why: "ACME — it proves control of each hostname to Let's Encrypt",
  },
  api: {
    needed: true,
    why: "the object store (verifyUpload, certificate archive), SMTP, a customer's Keycloak JWKS, and EIV-FOBI",
  },
  backup: {
    needed: true,
    why: "it writes every backup to the backup bucket",
  },
  postgres: {
    needed: false,
    why: "a database nothing outside should reach and which reaches nothing itself",
  },
  redis: {
    needed: false,
    why: "cache and queues, local to this host",
  },
  admin: {
    needed: false,
    why: "nginx serving static files — the browser makes the outbound calls, not the container",
  },
  portal: { needed: false, why: "as admin" },
  widget: { needed: false, why: "as admin" },
};

const problems = [];

/**
 * The networks declared `internal: true`.
 *
 * Parsed rather than hard-coded as `["internal"]`: the name of the network is
 * not the property that matters, and a second network added later with the
 * same flag has to be caught too.
 */
function internalNetworks(source) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === "networks:");
  if (start === -1) {
    problems.push(`${COMPOSE}: no top-level \`networks:\` block`);
    return new Set();
  }

  const internal = new Set();
  let current;

  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break; // the next top-level key
    const name = /^ {2}(\w[\w-]*):\s*$/u.exec(line);
    if (name) {
      current = name[1];
      continue;
    }
    if (current !== undefined && /^ {4}internal:\s*true\s*$/u.test(line)) {
      internal.add(current);
    }
  }

  return internal;
}

/** Each service's `networks: [a, b]` list. */
function serviceNetworks(source) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === "services:");
  if (start === -1) {
    problems.push(`${COMPOSE}: no top-level \`services:\` block`);
    return new Map();
  }

  const byService = new Map();
  let current;

  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const name = /^ {2}(\w[\w-]*):\s*$/u.exec(line);
    if (name) {
      current = name[1];
      continue;
    }
    const networks = /^ {4}networks:\s*\[([^\]]*)\]\s*$/u.exec(line);
    if (networks && current !== undefined) {
      byService.set(
        current,
        networks[1]
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value !== ""),
      );
    }
  }

  return byService;
}

const source = readFileSync(COMPOSE, "utf8");
const internal = internalNetworks(source);
const attached = serviceNetworks(source);

if (internal.size === 0) {
  // Not "nothing is internal, all good". Either the isolation was removed — a
  // decision that should be deliberate and is not this script's to make
  // quietly — or this parser no longer matches the file. Both are findings.
  problems.push(
    `${COMPOSE}: no network is declared \`internal: true\`. Either the ` +
      "isolation was removed (say so in an ADR) or this parser has drifted.",
  );
}

if (attached.size === 0) {
  problems.push(`${COMPOSE}: parsed no \`networks: [...]\` lines from any service`);
}

for (const [service, networks] of attached) {
  const expectation = EGRESS[service];

  if (expectation === undefined) {
    problems.push(
      `${service}: not in this script's table. Does its image make outbound ` +
        "connections? Add it to EGRESS with the answer and the reason.",
    );
    continue;
  }

  const hasGateway = networks.some((network) => !internal.has(network));

  if (expectation.needed && !hasGateway) {
    problems.push(
      `${service}: on ${networks.join(", ")}, all of which are \`internal: true\`, ` +
        `so it cannot open an outbound connection — but it needs ${expectation.why}. ` +
        "Add a non-internal network (`edge`). This publishes nothing: reachability " +
        "from outside the host is decided by `ports:`.",
    );
  }

  if (!expectation.needed && hasGateway) {
    problems.push(
      `${service}: reaches the internet, and this script says it should not ` +
        `(${expectation.why}). Either remove the non-internal network, or change ` +
        "the table here and say what it now calls out to.",
    );
  }
}

for (const service of Object.keys(EGRESS)) {
  if (!attached.has(service)) {
    problems.push(
      `${service}: in this script's table but has no \`networks: [...]\` line in ` +
        `${COMPOSE}. A service on the default network is not what this file ` +
        "describes anywhere else.",
    );
  }
}

if (problems.length > 0) {
  console.error("check-egress: the compose networks do not match what the code does\n");
  for (const problem of problems) console.error(`  ✘ ${problem}`);
  console.error("");
  process.exit(1);
}

const callsOut = Object.values(EGRESS).filter((entry) => entry.needed).length;
console.log(
  `check-egress: ${String(attached.size)} services, ` +
    `${String(callsOut)} of them reach the internet and can`,
);
