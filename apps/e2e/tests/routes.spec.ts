/**
 * Every route in the contract, probed (P36-01).
 *
 * ## Why generated from `contracts/openapi.yaml`
 *
 * A hand-written list of routes to check is a list somebody has to remember to
 * extend, and the route that gets forgotten is the new one — the one most
 * likely to be wrong. Reading the contract means the check grows itself: add a
 * path to the contract and it is probed on the next run, with no second place
 * to update.
 *
 * The contract is already the source for the SDK and the DTO parity test
 * (`CLAUDE.md` §2, contract-first). This makes it the source for reachability
 * too.
 *
 * ## What it asserts, and why only this
 *
 * Anonymously, with no session:
 *
 * - **The route exists.** Nest answers an unrouted path differently from a
 *   routed one, so a path documented but never implemented is visible here and
 *   nowhere else. That is a real failure mode of a contract-first repository:
 *   the contract is written first, and nothing checks that the second half
 *   happened.
 * - **It does not answer 5xx.** An unauthenticated request reaching a stack
 *   trace is both an availability bug and an information leak.
 * - **Anything tenant-scoped refuses.** No route under `/admin` may answer an
 *   anonymous caller with data.
 *
 * It deliberately does **not** assert status codes per route beyond that. What
 * a route returns *with* credentials is the API suites' job, against a real
 * Postgres, where the fixtures exist to make the answer meaningful.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { API_BASE } from "../support/stack.js";

interface Operation {
  readonly method: "get" | "post" | "put" | "patch" | "delete";
  readonly path: string;
}

/**
 * The contract's operations, by reading it as text rather than parsing YAML.
 *
 * Indentation is the grammar here: a path is two spaces deep, a method four.
 * That is fragile against a reformat and honest about it — the alternative is a
 * YAML dependency in a package that otherwise has three, to read a file whose
 * shape is enforced by `prettier` on every commit.
 */
function operations(): Operation[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path derived from this module's own URL, not from input
  const yaml = readFileSync(
    fileURLToPath(new URL("../../../contracts/openapi.yaml", import.meta.url)),
    "utf8",
  );

  const found: Operation[] = [];
  let path: string | undefined;

  for (const line of yaml.split("\n")) {
    const pathMatch = /^ {2}(\/[^\s:]*):/u.exec(line);
    if (pathMatch?.[1] !== undefined) {
      path = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}(get|post|put|patch|delete):/u.exec(line);
    if (methodMatch?.[1] !== undefined && path !== undefined) {
      found.push({ method: methodMatch[1] as Operation["method"], path });
    }
  }

  return found;
}

/** Path parameters filled with something syntactically valid but absent. */
function concrete(path: string): string {
  return path
    .replace(/\{[^}]*[Ii]d\}/gu, "00000000-0000-4000-8000-000000000000")
    .replace(/\{[^}]*\}/gu, "e2e-does-not-exist");
}

const OPERATIONS = operations();

test("the contract documents routes at all", () => {
  // A parser that silently found nothing would make every assertion below
  // vacuous — the failure mode this file exists to prevent, in the file itself.
  expect(OPERATIONS.length).toBeGreaterThan(50);
});

/**
 * The negative control, and the reason it is not optional.
 *
 * The check below decides "documented but not implemented" from the *shape* of
 * the 404 body. If the problem-details filter ever rewrites unrouted 404s into
 * the same shape as a handler's own, that test keeps passing while detecting
 * nothing — a check that cannot fail, which is worth less than no check because
 * it is believed.
 *
 * So: a path that certainly does not exist must be flagged by the same
 * predicate the real check uses. If this goes red, the check above has stopped
 * meaning anything, whatever it reports.
 */
test("an unimplemented route is actually detectable", async ({ request }) => {
  const response = await request.get(`${API_BASE}/definitely-not-a-route-e2e`, {
    failOnStatusCode: false,
  });

  expect(looksUnrouted(response.status(), await response.text())).toBe(true);
});

/** Nest names the method and path it could not match; a handler's 404 does not. */
function looksUnrouted(status: number, body: string): boolean {
  return status === 404 && /cannot\s+(get|post|put|patch|delete)/iu.test(body);
}

test("every documented route is implemented, refuses anonymously, and never 5xxs", async ({
  request,
}) => {
  const unrouted: string[] = [];
  const errored: string[] = [];
  const unprotected: string[] = [];

  for (const operation of OPERATIONS) {
    const url = `${API_BASE}${concrete(operation.path)}`;
    const response = await request.fetch(url, {
      method: operation.method.toUpperCase(),
      failOnStatusCode: false,
      // Enough to get past body validation to the guard, which is what is
      // being probed. A route that rejects this as malformed has still proved
      // it exists and still refused an anonymous caller.
      data: operation.method === "get" || operation.method === "delete" ? undefined : {},
      headers: { "content-type": "application/json" },
    });

    const label = `${operation.method.toUpperCase()} ${operation.path}`;
    const body = await response.text();

    if (looksUnrouted(response.status(), body)) unrouted.push(label);
    if (response.status() >= 500) errored.push(`${label} → ${response.status()}`);
    if (operation.path.startsWith("/admin") && response.status() < 400) {
      unprotected.push(`${label} → ${response.status()}`);
    }
  }

  expect(unrouted, "documented in the contract, implemented nowhere").toEqual([]);
  expect(errored, "answered 5xx to an anonymous request").toEqual([]);
  expect(unprotected, "an /admin route served an anonymous caller").toEqual([]);
});
