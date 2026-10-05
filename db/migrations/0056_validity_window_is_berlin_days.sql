-- A validity window is a pair of German calendar days (P243-01).
--
-- ## The defect
--
-- "Anerkennung gültig bis 12.10.2026" is a sentence about a day on a German
-- wall. `@ds/domain` `courseAvailability` reads `valid_to` as the last instant
-- the course is offered, and says callers store "the last moment of the day the
-- accreditation covers". Neither writer did:
--
--   * the console sent `${date}T00:00:00.000Z` for both ends. "bis 12.10." became
--     02:00 Berlin time **on** the 12th, so the course left the catalogue — and
--     every enrolled physician was refused at the next step, by
--     `requireCourseStillOffered` — for almost the whole last day the Bescheid
--     covers. "ab 13.10." opened at 02:00 instead of midnight.
--   * the seeds wrote `T23:59:59Z`, which is 01:59 on the **next** day in
--     Berlin. The learner's Zertifizierung tab rendered the MEDICE course as
--     accredited "bis 13.10.2026", one day past its Bescheid, and the course
--     stayed open two hours too long.
--
-- The console and seeds now store the Berlin day boundaries
-- (`windowFromDates`). This puts every row they wrote earlier on the same
-- footing, so the warning P243-01 adds names the right last day.
--
-- ## Which rows, and why it is safe to say what they meant
--
-- Only values with the exact shapes those two writers produced: a UTC
-- time-of-day of 00:00:00 (console, either end) or 23:59:59[.999] (seed, end
-- only). For those the intended day is unambiguous — it is the UTC date the
-- writer typed. A value with any other time of day was written some other way
-- and is left exactly as it is. Rows already on a Berlin boundary have a UTC
-- time of 22:00/23:00 or 21:59/22:59 and do not match, so this is idempotent.
--
-- The window moves by at most two hours at each end, towards what the Bescheid
-- says. Nothing is extended past the day an operator entered.

BEGIN;

-- `courses` is under FORCE ROW LEVEL SECURITY and `ds_migrator` is not
-- BYPASSRLS: without this the UPDATE matches zero rows and reports success
-- (§9.6). Same dance as 0042 and 0047.
ALTER TABLE courses NO FORCE ROW LEVEL SECURITY;
ALTER TABLE courses DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    v_to   integer;
    v_from integer;
BEGIN
    -- End: the last millisecond of that day in Berlin.
    UPDATE courses
       SET valid_to = (((valid_to AT TIME ZONE 'UTC')::date + 1)::timestamp
                        AT TIME ZONE 'Europe/Berlin') - interval '1 millisecond',
           updated_at = now()
     WHERE valid_to IS NOT NULL
       AND (valid_to AT TIME ZONE 'UTC')::time IN (time '00:00:00', time '23:59:59', time '23:59:59.999');
    GET DIAGNOSTICS v_to = ROW_COUNT;

    -- Start: the first instant of that day in Berlin.
    UPDATE courses
       SET valid_from = ((valid_from AT TIME ZONE 'UTC')::date)::timestamp
                        AT TIME ZONE 'Europe/Berlin',
           updated_at = now()
     WHERE valid_from IS NOT NULL
       AND (valid_from AT TIME ZONE 'UTC')::time = time '00:00:00';
    GET DIAGNOSTICS v_from = ROW_COUNT;

    -- To the append-only log, so a course whose window moved is explained by
    -- the deploy that moved it (0047's reasoning). Counts, never values.
    IF v_to + v_from > 0 THEN
        INSERT INTO audit_log (customer_id, actor_id, actor_identity, action, subject, detail)
        VALUES (
            NULL, NULL, 'system', 'admin.course.window_normalised_by_migration', '0056',
            jsonb_build_object(
                'valid_to', v_to,
                'valid_from', v_from,
                'reason', 'validity dates stored as UTC instants re-read as German calendar days'
            )
        );
    END IF;
END
$$;

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'courses' AND relrowsecurity AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION 'courses left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;
END
$$;

COMMIT;
