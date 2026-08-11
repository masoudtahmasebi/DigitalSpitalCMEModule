/**
 * Pretend the learner has been here a while (P55-01).
 *
 * ## Why every playback suite needs this
 *
 * The API refuses a report claiming more playback than there has been time
 * for, measured from the learner's last recorded activity — the newest
 * `content_progress.updated_at`, or `enrolments.created_at` when they have
 * touched nothing yet. That is the anti-skip rule's load-bearing half: without
 * it, one request completes any video.
 *
 * An integration test enrols and watches ten minutes of video in a few
 * milliseconds, which is exactly the shape the rule exists to refuse. So the
 * suites move the clock instead of weakening the rule.
 *
 * ## Why both timestamps
 *
 * Moving only `content_progress` was enough until P55-01, because a *first*
 * report used to be given the video's own duration as its budget. It is not
 * any more — that was the hole — so a first report now measures from the
 * enrolment, and a helper that moved one timestamp and not the other left
 * every first-report case with a budget of zero.
 *
 * Unscoped on purpose: `reset-each-file.ts` truncates between files, so the
 * only rows present belong to the suite that is running.
 */

import type { Pool } from "pg";

export async function backdateLearnerClock(pool: Pool, seconds: number): Promise<void> {
  const interval = `($1 || ' seconds')::interval`;
  await pool.query(`UPDATE content_progress SET updated_at = now() - ${interval}`, [
    String(seconds),
  ]);
  await pool.query(`UPDATE enrolments SET created_at = now() - ${interval}`, [
    String(seconds),
  ]);
}
