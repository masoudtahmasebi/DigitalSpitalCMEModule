#!/usr/bin/env node
/**
 * Every structural write in the authoring service passes the content lock.
 *
 * ## Why this script exists
 *
 * `content_locked` (P178-01) is a rule with **eleven call sites**, and CLAUDE.md
 * §9.3 is the record of what happens to those: `inviteStatus` was exhaustively
 * unit-tested and called from nowhere; `invalidBrandingFields` was written so a
 * form could report a rejected value and called by nothing. A guard that has to
 * be remembered once per method is a guard the twelfth method forgets, and the
 * failure is silent — the edit succeeds, a physician who had finished the
 * Fortbildung drops below the watch gate, and nothing anywhere says so.
 *
 * The integration suite exercises each route that exists today. This exists for
 * the route that does not exist yet: it derives the list of structural writes
 * from the **repository port** rather than from a list somebody maintains, so
 * adding `deleteQuestion` to the port and calling it from an unguarded service
 * method fails here rather than in production.
 *
 * ## What it checks
 *
 * 1. Every method on `AuthoringRepositoryPort` that writes the tree is either
 *    named in `STRUCTURAL` or in `NOT_STRUCTURAL`, with a reason. A new one is
 *    in neither, and that is an error — the point is that somebody has to
 *    decide, which is more than was happening.
 * 2. Every `AuthoringService` method that calls a `STRUCTURAL` repository
 *    method also calls `slugForEdit` or `assertUnlocked` — the two ways into
 *    the refusal — before it.
 *
 * Run by `pnpm verify`, not only CI (§9.11): a check that runs only in CI is a
 * check the person writing the code does not run.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const servicePath = fileURLToPath(
  new URL("apps/api/src/modules/authoring/authoring.service.ts", root),
);
const repositoryPath = fileURLToPath(
  new URL("apps/api/src/modules/authoring/authoring.repository.ts", root),
);

/** Writes that change the material a learner is graded against. */
const STRUCTURAL = new Set([
  "createModule",
  "updateModule",
  "deleteModule",
  "createChapter",
  "updateChapter",
  "deleteChapter",
  "createContent",
  "updateContent",
  "deleteContent",
  "applyOrder",
  "applyQuiz",
  "applyEvaluation",
]);

/**
 * Writes the lock deliberately does not cover, each with the reason it is out.
 *
 * These are the course's **identity and presentation**, not its material. A VNR
 * arrives from the Anerkennungsbescheid weeks after a course is built and has
 * to reach every certificate; a lock that refused it would make the platform
 * unable to record the number the Ärztekammer identifies the event by.
 */
const NOT_STRUCTURAL = new Map([
  ["createCourse", "there is nothing to lock yet"],
  ["cloneCourse", "reads the source; the copy is created unlocked, on purpose"],
  ["deleteCourse", "already refused outright once anybody has enrolled"],
  ["createDepartment", "organisation, not course material"],
  ["updateDepartment", "organisation, not course material"],
  ["deleteDepartment", "organisation, not course material"],
  ["createProject", "organisation, not course material"],
  ["updateProject", "organisation, not course material"],
  ["deleteProject", "organisation, not course material"],
  ["replaceExperts", "Referenten are presentation, like the title and hero image"],
  ["audit", "append-only log, never course material"],
]);

const WRITE = /^\s{2}(?<name>[a-zA-Z][A-Za-z0-9_]*)\(/;

function portMethods(source) {
  const start = source.indexOf("export interface AuthoringRepositoryPort");
  if (start === -1) throw new Error("AuthoringRepositoryPort not found");
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);

  const names = [];
  for (const line of body.split("\n")) {
    const match = WRITE.exec(line);
    if (match?.groups !== undefined) names.push(match.groups.name);
  }
  return names;
}

/** `AuthoringService`'s methods, each as `[name, body]`. */
function serviceMethods(source) {
  const header =
    /^ {2}(?:private |protected |public )?(?:async )?([a-zA-Z][A-Za-z0-9_]*)\(/;
  const lines = source.split("\n");
  const found = [];
  let current;

  for (const line of lines) {
    const match = header.exec(line);
    if (match !== null) {
      if (current !== undefined) found.push(current);
      current = { name: match[1], body: "" };
      continue;
    }
    if (current !== undefined) current.body += `${line}\n`;
  }
  if (current !== undefined) found.push(current);
  return found;
}

const service = readFileSync(servicePath, "utf8");
const repository = readFileSync(repositoryPath, "utf8");
const problems = [];

// 1. The list is complete against the port.
const writeVerb = /^(create|update|delete|apply|replace|set)/;
for (const name of portMethods(repository)) {
  if (!writeVerb.test(name)) continue;
  if (STRUCTURAL.has(name) || NOT_STRUCTURAL.has(name)) continue;
  problems.push(
    `${name} is a write on AuthoringRepositoryPort and is in neither STRUCTURAL ` +
      `nor NOT_STRUCTURAL. Decide whether the content lock (P178-01) covers it, ` +
      `and say so in scripts/check-content-lock.mjs.`,
  );
}

// 2. Every service method reaching a structural write goes through the guard.
let guarded = 0;
for (const { name, body } of serviceMethods(service)) {
  const writes = [...STRUCTURAL].filter((write) =>
    body.includes(`this.repository.${write}(`),
  );
  if (writes.length === 0) continue;

  if (body.includes("slugForEdit(") || body.includes("assertUnlocked(")) {
    guarded += 1;
    continue;
  }
  problems.push(
    `AuthoringService.${name} calls this.repository.${writes.join(", ")} without ` +
      `slugForEdit() or assertUnlocked(): a content-locked course would accept ` +
      `the edit (P178-01).`,
  );
}

if (guarded === 0) {
  problems.push(
    "no guarded structural write found at all — this check has stopped parsing " +
      "AuthoringService and is green for the wrong reason (§9.1).",
  );
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-content-lock: ${problem}`);
  process.exit(1);
}

console.log(
  `check-content-lock: ${String(guarded)} authoring methods reach a structural ` +
    `write, all through the lock`,
);
