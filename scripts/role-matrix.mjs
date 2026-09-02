/**
 * Every console screen, against the routes it calls, for every staff role
 * (P41-02).
 *
 * ## Why this exists
 *
 * Three defects in one week had the same shape: **the console offers something
 * the API refuses.**
 *
 * - `course_editor` was drawn a full menu and 403'd on the console's very first
 *   request, so the whole screen read "Ihr Konto hat keine Berechtigung für die
 *   Verwaltung" (P38-02).
 * - Its Organisation entry could only ever produce an error, because that
 *   screen reads projects and the role could not (P38-02).
 * - `department_admin` had exactly the same problem on the same screen, and it
 *   survived the first fix because nobody checked the *other* roles (P41-02).
 *
 * Each was found by a person clicking. That is the wrong instrument for a
 * question with four roles and nine screens: thirty-six answers, all of them
 * derivable from source.
 *
 * ## What it checks
 *
 * For every role and every navigation entry the console would draw for it:
 * does each route that screen loads on mount accept that role?
 *
 * It reads three files rather than a hand-written table — the capability matrix
 * in `@ds/domain`, the `NAV` array in the console, and the `@Roles` decorators
 * on the controllers — so a role added to any of them is covered on the next
 * run without this file changing.
 *
 * ## What it deliberately does not check
 *
 * Writes. A screen an operator may *see* and not *change* is a legitimate and
 * common design here — a department administrator reads the Keycloak binding
 * they may not edit — and the refusal on the button is the boundary working.
 * What is never legitimate is a screen that cannot finish loading.
 */

import { readFileSync } from "node:fs";

/** What each screen fetches when it mounts. Hand-kept, and the only such list. */
const SCREEN_LOADS = {
  customers: ["GET /admin/customers"],
  organisation: ["GET /admin/departments", "GET /admin/projects"],
  courses: ["GET /admin/courses"],
  participants: ["GET /admin/participants"],
  learners: ["GET /admin/learners"],
  certificates: ["GET /admin/certificates"],
  staff: ["GET /admin/staff"],
  branding: ["GET /admin/branding/font"],
  // Texte (P83-04). One read at mount, and it is the same one Organisation
  // makes — copy is stored per project, so the screen has to list them before
  // it can show anything.
  copy: ["GET /admin/projects"],
  // Mediathek (P88-01). One read at mount — the customer's own file index,
  // bounded by RLS rather than by a course.
  media: ["GET /admin/media"],
  // Punktemeldungen (P110-01). One read at mount, bounded by RLS to the
  // caller's customer — the queue is per installation, not per course.
  punktemeldungen: ["GET /admin/eiv/submissions"],
  security: ["GET /admin/auth/second-factor/policy"],
};

const ROLES = ["super_admin", "customer_admin", "department_admin", "course_editor"];

function capabilities() {
  const source = readFileSync("packages/domain/src/staff-identity.ts", "utf8");
  const block = source.slice(
    source.indexOf("const CAPABILITIES"),
    source.indexOf("/** Whether this role may create"),
  );
  const held = {};
  for (const role of ROLES) {
    const match = new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`, "s").exec(block);
    held[role] =
      match === null ? [] : [...match[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  }
  return held;
}

/** The nav entries the console draws, and the capability each one needs. */
function navigation() {
  const source = readFileSync("apps/admin/src/App.tsx", "utf8");
  const start = source.indexOf("const NAV:");
  const nav = source.slice(start, source.indexOf("\n];", start));
  const entries = [];

  /*
   * Split on the entries rather than matching across them.
   *
   * The first version used a bounded lookahead (`[\s\S]{0,400}?`) and found
   * five of the nine — so it reported "every drawn screen loads" while
   * silently checking a bit over half the console. Which is the exact failure
   * this whole script exists to catch, one level up: a green result that is
   * green because of what it did not look at.
   *
   * Hence `expected` below. A parser that can under-report has to be able to
   * notice that it did.
   */
  for (const chunk of nav.split(/kind:\s*"/).slice(1)) {
    const kind = /^([a-z-]+)"/.exec(chunk)?.[1];
    if (kind === undefined) continue;
    const capability = /capability:\s*"([a-z_]+)"/.exec(chunk);
    // Whether the entry says what its screen is for. See `undescribed` below.
    const described = /description:\s*de\./.test(chunk);
    entries.push({ kind, capability: capability?.[1], described });
  }
  return entries;
}

/** Which roles each `GET` route accepts, read off the decorators. */
function routeRoles() {
  const accepts = {};
  const files = [
    "apps/api/src/modules/admin/admin.controller.ts",
    "apps/api/src/modules/authoring/authoring.controller.ts",
    "apps/api/src/modules/moderation/moderation.controller.ts",
    "apps/api/src/modules/participants/participant.controller.ts",
    "apps/api/src/modules/customers/customer.controller.ts",
    "apps/api/src/modules/staff/staff-accounts.controller.ts",
    "apps/api/src/modules/staff/staff-auth.controller.ts",
  ];

  for (const file of files) {
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }

    /*
     * The `const X = [...]` aliases the decorators spread.
     *
     * Any UPPER_SNAKE constant, not only names ending in `ROLES`. The first
     * version required that suffix and so resolved `RECORD_READERS` to the
     * empty list — which made this script report that a super administrator
     * cannot open a screen they have always been able to open. A checker that
     * cries wolf is a checker somebody switches off, so the pattern is the
     * shape of the declaration rather than a naming convention nobody agreed
     * to.
     */
    const aliases = {};
    for (const m of source.matchAll(/const ([A-Z][A-Z_]*)\s*=\s*\[([^\]]*)\]/gs)) {
      aliases[m[1]] = [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
      for (const spread of m[2].matchAll(/\.\.\.([A-Z][A-Z_]*)/g)) {
        aliases[m[1]].push(...(aliases[spread[1]] ?? []));
      }
    }

    const controller = /@Controller\("([^"]*)"\)/.exec(source)?.[1] ?? "";
    // A capability-gated controller accepts every role holding it.
    const capability = /@StaffCapability\("([a-z_]+)"\)/.exec(source)?.[1];

    for (const m of source.matchAll(
      /@Get\("([^"]*)"\)\s*(?:@[A-Za-z]+\([^)]*\)\s*)*?@Roles\(([^)]*)\)/g,
    )) {
      const path = `GET /${[controller, m[1]].filter(Boolean).join("/")}`;
      const roles = [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
      for (const spread of m[2].matchAll(/\.\.\.([A-Z][A-Z_]*)/g)) {
        roles.push(...(aliases[spread[1]] ?? []));
      }
      accepts[path] = roles;
    }

    if (capability !== undefined) {
      for (const m of source.matchAll(/@Get\("?([^")]*)"?\)/g)) {
        const path = `GET /${[controller, m[1]].filter(Boolean).join("/")}`.replace(
          /\/$/,
          "",
        );
        accepts[path] ??= { capability };
      }
    }
  }
  return accepts;
}

const held = capabilities();
const nav = navigation();

/*
 * Every screen this script knows how to check must have been found in the
 * console's navigation, and vice versa. Without this the script degrades
 * quietly: a rename in `App.tsx` drops a screen from the sweep and the run
 * still says "every drawn screen loads".
 */
const known = Object.keys(SCREEN_LOADS).sort();
const found = nav.map((entry) => entry.kind).sort();
if (JSON.stringify(known) !== JSON.stringify(found)) {
  console.error(
    "role-matrix: the navigation and this script's screen list disagree.\n" +
      `  navigation: ${found.join(", ")}\n` +
      `  this script: ${known.join(", ")}\n` +
      "Add the new screen's mount-time reads to SCREEN_LOADS, or fix the parser.",
  );
  process.exit(1);
}
const accepts = routeRoles();
const problems = [];

for (const role of ROLES) {
  for (const entry of nav) {
    // Not drawn for this role — nothing to check.
    if (entry.capability !== undefined && !held[role].includes(entry.capability))
      continue;

    for (const route of SCREEN_LOADS[entry.kind] ?? []) {
      const rule = accepts[route];
      if (rule === undefined) continue; // not resolvable from decorators; skipped
      const ok = Array.isArray(rule)
        ? rule.includes(role)
        : held[role].includes(rule.capability);
      if (!ok) {
        problems.push(
          `${role} is drawn "${entry.kind}" but ${route} refuses it — ` +
            `the screen can only render an error`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error("role-matrix: screens a role can open and cannot load\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

/*
 * Every screen says what it is for (P136-01).
 *
 * A reviewer looking at the console as its *user* rather than its author put it
 * exactly: the Fortbildung side explains itself from the screens, and the
 * administration does not — "if I look at the viewer who is going to use it,
 * few things still need to be improved".
 *
 * `Fortbildungen` — the screen an operator opens first — had no description at
 * all, and nothing said so, because a missing sentence breaks nothing. That is
 * §9.4 in the place it is hardest to see: the screen was correct, loaded for
 * every role that is drawn it, and left a newcomer to infer that a course they
 * create is invisible until they publish it.
 *
 * Checked here rather than in a test because this file already parses `NAV` and
 * already runs in `pnpm verify` and in CI. A screen added without a description
 * fails, which is the only way a sentence nobody is forced to write gets
 * written.
 */
const undescribed = nav.filter((entry) => !entry.described).map((entry) => entry.kind);

if (undescribed.length > 0) {
  console.error(
    "role-matrix: screens that do not say what they are for\n\n" +
      undescribed.map((kind) => `  ${kind}`).join("\n") +
      "\n\nGive the NAV entry a `description:` naming what the section is and, " +
      "where two screens read alike, how it differs from its neighbour.",
  );
  process.exit(1);
}

console.log(
  `role-matrix: ${ROLES.length} roles × ${nav.length} screens, ` +
    "every drawn screen loads and says what it is for",
);
