/**
 * Every seeded course is shaped like a real course (P52-03).
 *
 * ## The rule
 *
 *   at least 2 modules · each with at least 2 chapters · each chapter with at
 *   least one piece of content
 *
 * ## Why a check rather than a note in the seed
 *
 * Because the seeds were all shallow and nobody noticed for eleven phases. One
 * module per chapter or one chapter per module both *look* fine in the console
 * and in a screenshot, and both quietly remove a code path from every fixture:
 * `courseChapterSequence` gates within a module and between modules on
 * different branches, and a course that has only one kind of transition can
 * never show the other one working or broken.
 *
 * Deepening the fixtures immediately found a real defect — `ds-demo`'s seeder
 * put a quiz in *every* chapter of the last module and questions in only one of
 * them, which is a 500 for a learner opening any of the others. It survived
 * because the shape that exposes it did not exist. That is the argument for
 * pinning the shape rather than the instance (CLAUDE.md §9.11).
 *
 * ## Why it reads the database rather than the seed source
 *
 * The seeds are three separate TypeScript files with three different loops, and
 * a fourth will be written eventually. Parsing them would check the code that
 * exists today rather than the courses that exist after running it — the
 * `role-matrix.mjs` mistake, where a checker silently covered five of nine
 * screens and reported on all nine (§9.1).
 *
 * So this asks Postgres what is actually there, which also catches a course
 * somebody created by hand in the console and a seed that half-failed.
 *
 * ## Running it
 *
 *   node scripts/check-seed-structure.mjs
 *
 * Against the development database by default; set `DATABASE_URL` or
 * `POSTGRES_SUPERUSER_URL` to point it elsewhere. Exits non-zero on the first
 * course that does not comply, naming the course and what is wrong with it.
 *
 * **The connection must not be subject to RLS.** `courses` is tenant-scoped, so
 * `ds_app` with no `app.customer_id` set sees zero rows — and the first version
 * of this script read that as "the database is empty" and said so, about a
 * database that had just been seeded three times. That is CLAUDE.md §9.6
 * happening to the checker rather than to the product. It now detects the case
 * and says which of the two it is.
 *
 * `EXEMPT_COURSES` is the deliberate escape hatch, and it has one entry: see
 * the constant.
 */

import pg from "pg";

/**
 * Courses that are allowed to be shallow, and why.
 *
 * `adhs-akademie-adult` mirrors the real Ärztekammer Westfalen-Lippe
 * Anerkennungsbescheid: five modules, one chapter each, because that is how
 * the accredited course is actually structured. Reshaping it to satisfy a test
 * would make the fixture stop matching the document it exists to represent,
 * which is a worse outcome than an exemption somebody can read.
 *
 * An entry here is a claim that reality is shallow, not that the check is
 * inconvenient. Anything added without that justification is the exemption
 * quietly becoming the rule.
 */
const EXEMPT_COURSES = new Map([
  [
    "adhs-akademie-adult",
    "mirrors the real ÄKWL Anerkennungsbescheid, which has one chapter per module",
  ],
]);

const MIN_MODULES = 2;
const MIN_CHAPTERS_PER_MODULE = 2;

const url =
  process.env["DATABASE_URL"] ??
  process.env["POSTGRES_SUPERUSER_URL"] ??
  "postgres://postgres:postgres@127.0.0.1:5432/ds_education";

const pool = new pg.Pool({ connectionString: url });

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.error(`  ✗ ${message}`);
};

try {
  const { rows } = await pool.query(`
    SELECT c.slug,
           m.id            AS module_id,
           m.ordinal       AS module_ordinal,
           ch.id           AS chapter_id,
           ch.ordinal      AS chapter_ordinal,
           count(co.id) FILTER (WHERE co.kind <> 'material') AS lesson_contents
      FROM courses c
      LEFT JOIN modules  m  ON m.course_id  = c.id
      LEFT JOIN chapters ch ON ch.module_id = m.id
      LEFT JOIN contents co ON co.chapter_id = ch.id
     GROUP BY c.slug, m.id, m.ordinal, ch.id, ch.ordinal
     ORDER BY c.slug, m.ordinal, ch.ordinal
  `);

  if (rows.length === 0) {
    // Two very different causes, and guessing wrong sends the reader to the
    // wrong place. Ask the database which it is.
    const { rows: who } = await pool.query(
      "SELECT current_user AS name, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses",
    );
    const role = who[0]?.name ?? "unknown";
    const bypasses = who[0]?.bypasses === true;

    if (bypasses) {
      console.error(
        `check-seed-structure: no courses found, and ${role} can see every row.\n` +
          "  The database really is empty. Run: pnpm db:dev:reset",
      );
    } else {
      console.error(
        `check-seed-structure: no courses visible to ${role}, which is subject to\n` +
          "  row-level security and has no tenant context. This says nothing about\n" +
          "  whether the database is seeded (CLAUDE.md §9.6).\n" +
          "  Point DATABASE_URL at a role that bypasses RLS — the superuser used by\n" +
          "  scripts/devdb.mjs does.",
      );
    }
    process.exit(1);
  }

  /** slug → module id → chapter id → lesson content count */
  const courses = new Map();
  for (const row of rows) {
    if (!courses.has(row.slug)) courses.set(row.slug, new Map());
    if (row.module_id === null) continue;
    const modules = courses.get(row.slug);
    if (!modules.has(row.module_id)) modules.set(row.module_id, new Map());
    if (row.chapter_id === null) continue;
    modules.get(row.module_id).set(row.chapter_id, Number(row.lesson_contents));
  }

  for (const [slug, modules] of [...courses].sort()) {
    const exemption = EXEMPT_COURSES.get(slug);
    if (exemption !== undefined) {
      console.warn(`  – ${slug}: exempt — ${exemption}`);
      continue;
    }

    // Counted per course, not globally. The first version compared a global
    // total and printed a ✓ line for a course it had just printed a ✗ for —
    // a checker contradicting itself in its own output, which is worse than
    // no output because a reader skimming for ✓ finds one.
    const before = failures;

    const chapterCounts = [...modules.values()].map((chapters) => chapters.size);
    const shallow = chapterCounts.filter((n) => n < MIN_CHAPTERS_PER_MODULE).length;

    if (modules.size < MIN_MODULES) {
      fail(`${slug}: ${modules.size} module(s), needs at least ${MIN_MODULES}`);
    } else if (shallow > 0) {
      fail(
        `${slug}: ${shallow} of ${modules.size} module(s) have fewer than ` +
          `${MIN_CHAPTERS_PER_MODULE} chapters (${chapterCounts.join(", ")})`,
      );
    }

    // An empty chapter is a dead end on screen: it is reachable, it gates the
    // chapter after it, and it contains nothing to complete. Counted
    // separately from the module rule so the message says which it is.
    //
    // Materials do not count. A Mediathek download has no completion event, so
    // a chapter holding only a PDF can never be finished and would lock every
    // chapter after it forever — which is exactly the failure this catches.
    for (const [moduleId, chapters] of modules) {
      const empty = [...chapters.values()].filter((n) => n === 0).length;
      if (empty > 0) {
        fail(
          `${slug}: module ${moduleId} has ${empty} chapter(s) with no ` +
            `completable content (a materials-only chapter locks everything after it)`,
        );
      }
    }

    if (failures === before) {
      const total = chapterCounts.reduce((a, b) => a + b, 0);
      console.warn(`  ✓ ${slug}: ${modules.size} modules, ${total} chapters`);
    }
  }
} finally {
  await pool.end();
}

if (failures > 0) {
  console.error(
    `\ncheck-seed-structure: ${failures} course(s) are not shaped like a real course.\n` +
      "  At least 2 modules, each with at least 2 chapters, each chapter with\n" +
      "  something completable in it. See the header for why this is checked.",
  );
  process.exit(1);
}

console.warn("check-seed-structure: every course is shaped like a real course");
