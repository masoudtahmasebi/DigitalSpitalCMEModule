/**
 * Every pass verdict goes through `meetsPassThreshold` (P248-01, ARCH-3).
 *
 * ## Why a source scan, and not only a behavioural test
 *
 * A caller reverted from `meetsPassThreshold(score, threshold)` to
 * `score >= threshold` behaves identically today, so no request can tell the
 * two apart — and that is exactly how the comparison came to be written out
 * five times. The behavioural half lives in `one-number.integration.test.ts`,
 * which drives every caller with a score *equal* to the threshold, so a caller
 * that drifts to `>` goes red there. This file is the other half: a copy that
 * is still correct today is still a second rule (CLAUDE.md §4 invariant 6,
 * §9.7 — name the caller).
 *
 * The scan proves it scanned (§9.1): it asserts how many files it read and
 * that the named callers were among them.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const ROOTS = ["apps/api/src", "apps/widget/src"];

/** A score compared with a pass threshold, in either order, outside a call. */
const INLINE_COMPARISON = [
  /(>=|<=|[^=]>|<)\s*[\w.]*[pP]assThreshold\w*(?!\w|\s*\()/,
  /[pP]assThreshold\w*\s*(>=|<=|>(?!=)|<)\s*[\w.(]/,
];

/**
 * Comparisons of a threshold with something that is not a score.
 *
 * `ACCREDITED_MIN_PASS_PERCENT` (`admin.service.ts`) bounds what an operator
 * may *set* the threshold to; it is not a pass verdict, and routing it through
 * `meetsPassThreshold` would read as one.
 */
const NOT_A_VERDICT = [/passThresholdPercent < ACCREDITED_MIN_PASS_PERCENT/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [path];
  });
}

const files = ROOTS.flatMap((root) => sources(join(REPO, root)));

function callsIn(path: string): number {
  return (
    readFileSync(join(REPO, path), "utf8").match(/\bmeetsPassThreshold\(/g)?.length ?? 0
  );
}

describe("the pass-threshold comparison has one home (P248-01)", () => {
  it("scans the API and the widget, not an empty directory", () => {
    expect(files.length).toBeGreaterThan(100);
    const scanned = files.map((path) => relative(REPO, path));
    expect(scanned).toContain("apps/api/src/modules/assessment/assessment.service.ts");
    expect(scanned).toContain("apps/api/src/modules/learning/learning.service.ts");
    expect(scanned).toContain("apps/widget/src/player.ts");
  });

  it("finds no score compared with a pass threshold outside meetsPassThreshold", () => {
    const hits = files.flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => !/^\s*(\*|\/\/)/.test(line))
        .filter(({ line }) => INLINE_COMPARISON.some((pattern) => pattern.test(line)))
        .filter(({ line }) => !NOT_A_VERDICT.some((pattern) => pattern.test(line)))
        .map(({ line, index }) => `${relative(REPO, path)}:${index + 1}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("would find one: the pattern matches each shape it replaced", () => {
    // The operator is spliced in so this file does not itself match the
    // ticket's `grep -rnE ">= *[a-zA-Z.]*passThreshold" apps/api/src`.
    const GE = ">=";
    for (const line of [
      `if (bestSoFar !== null && bestSoFar ${GE} enrolment.passThresholdPercent) {`,
      `passed: bestScore ${GE} enrolment.passThresholdPercent,`,
      `return score !== undefined && score ${GE} passThresholdPercent;`,
      `return score ${GE} state.passThresholdPercent ? score : undefined;`,
      "if (passThresholdPercent <= score) return true;",
    ]) {
      expect(
        INLINE_COMPARISON.some((pattern) => pattern.test(line)),
        line,
      ).toBe(true);
    }
  });

  it("is called by the re-attempt guard and the progress upsert", () => {
    expect(callsIn("apps/api/src/modules/assessment/assessment.service.ts")).toBe(2);
  });

  it("is called by hasPassedQuiz, the rollup's quiz verdict", () => {
    expect(callsIn("apps/api/src/modules/learning/learning.service.ts")).toBe(1);
  });

  it("is called by the widget's passedQuizScore", () => {
    expect(callsIn("apps/widget/src/player.ts")).toBe(1);
  });
});
