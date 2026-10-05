/**
 * Every id in a path and every scalar query parameter goes through a pipe
 * (P250-03).
 *
 * The pipes in `request-params.ts` are applied per parameter, so the failure
 * mode is the one this repository keeps meeting (CLAUDE.md §9.3): a rule that
 * exists and is not called. A new route taking `@Param("id")` without
 * `UuidParam` answers 500 to `/…/not-a-uuid` and nothing else would notice.
 * So this reads every controller and fails on the parameter that lacks it.
 *
 * The exceptions are named, with the reason, rather than pattern-matched away.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULES = fileURLToPath(new URL("../modules", import.meta.url));

/**
 * `file:param` (or `file:?query`) pairs that deliberately take no pipe. Each
 * already answers a malformed value with **404**, on purpose, and must keep
 * doing so.
 */
const EXEMPT: ReadonlyMap<string, string> = new Map([
  [
    "uploads/public-media.controller.ts:id",
    "public, unauthenticated: a malformed id is 'no such image', like any other (P212-01)",
  ],
  [
    "learning/learning.controller.ts:contentId",
    "learner plane: an unknown content item is 404 whatever its shape",
  ],
  [
    "assessment/assessment.controller.ts:contentId",
    "learner plane: an unknown quiz is 404 whatever its shape",
  ],
  [
    "projects/branding.controller.ts:?project",
    "public font route: a slug it cannot resolve, repeated or not, is 404 (measured)",
  ],
]);

function controllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith(".controller.ts") ? [path] : [];
  });
}

interface Finding {
  readonly where: string;
  readonly decorator: string;
}

function unguarded(): Finding[] {
  const findings: Finding[] = [];
  for (const file of controllers(MODULES)) {
    const name = relative(MODULES, file);
    const source = readFileSync(file, "utf8");

    // An id-shaped path parameter without `UuidParam` as its pipe.
    for (const match of source.matchAll(/@Param\("([a-zA-Z]+)"([^)]*)\)/gu)) {
      const param = match[1] ?? "";
      const pipes = match[2] ?? "";
      if (param !== "id" && !param.endsWith("Id")) continue;
      if (pipes.includes("UuidParam")) continue;
      if (EXEMPT.has(`${name}:${param}`)) continue;
      findings.push({ where: name, decorator: match[0] });
    }

    // A named query parameter read as a scalar without `SingleQueryValue`.
    // `@Query()` with no name is a whole-object read, parsed by a schema.
    for (const match of source.matchAll(/@Query\("([^"]+)"([^)]*)\)/gu)) {
      if ((match[2] ?? "").includes("SingleQueryValue")) continue;
      if (EXEMPT.has(`${name}:?${match[1] ?? ""}`)) continue;
      findings.push({ where: name, decorator: match[0] });
    }
  }
  return findings;
}

describe("path ids and query parameters are checked before they reach a query", () => {
  it("finds no id parameter or named query parameter without its pipe", () => {
    expect(unguarded()).toEqual([]);
  });

  it("has read the controllers it claims to (not green on an empty scan)", () => {
    // §9.1: a scan that matched nothing would pass the case above.
    const ids = controllers(MODULES)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .match(/@Param\("[a-zA-Z]*(?:id|Id)", UuidParam\)/gu);
    expect(ids?.length ?? 0).toBeGreaterThanOrEqual(31);
  });
});
