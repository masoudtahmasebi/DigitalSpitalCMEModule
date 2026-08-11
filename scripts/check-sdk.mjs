/**
 * The generated SDK, against the contract it is generated from (P41-03).
 *
 * ## Why this is a local check and not only a CI one
 *
 * CI has verified this since P2-06 and it works: it caught two commits where
 * `contracts/openapi.yaml` gained routes and `packages/sdk/src/generated/`
 * did not. What it could not do is stop them being pushed, because the check
 * lived only in CI — so the loop was "edit the contract, run every local gate
 * green, push, wait ten minutes, read a diff".
 *
 * `pnpm --filter @ds/sdk build` runs `tsc`, which compiles the *existing*
 * generated file happily. Only `generate` re-derives it. Two verbs, one of them
 * easy to think is the other, and nothing local said so.
 *
 * The mistake that prompted this: two new paths added to the contract, the SDK
 * built rather than generated, both commits red on a check that had been right
 * all along.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const GENERATED = "packages/sdk/src/generated/schema.ts";

/*
 * Compared before against after, not against `HEAD`.
 *
 * The first version asked `git status --porcelain -- packages/sdk`, which in
 * CI is exact — the tree is clean there — and locally answers a different
 * question: "do you have uncommitted SDK changes", which is true and harmless
 * every time somebody is mid-edit. A gate that fires when nothing is wrong is
 * a gate people learn to ignore, which is how the check that would have caught
 * this ended up living only in CI in the first place.
 */
const before = readFileSync(GENERATED, "utf8");
execFileSync("pnpm", ["--filter", "@ds/sdk", "generate"], { stdio: "pipe" });
const after = readFileSync(GENERATED, "utf8");

if (before !== after) {
  console.error(
    "check-sdk: the generated SDK was out of date with contracts/openapi.yaml.\n\n" +
      "It has just been regenerated — review and commit the change.\n" +
      "`pnpm --filter @ds/sdk build` compiles the old output; only `generate`\n" +
      "re-derives it from the contract.",
  );
  process.exit(1);
}

console.log("check-sdk: generated SDK matches the contract");
