/**
 * Publish a fixture course the way the schema now requires (P62-02).
 *
 * ## Why this exists
 *
 * `courses_published_cme_is_complete` refuses any row that is `published`,
 * awards CME points, and is missing a field the Teilnahmebescheinigung or the
 * Punktemeldung reads. Five integration suites inserted exactly that row —
 * `INSERT INTO courses (…, cme_points, status) VALUES (…, 4, 'published')` —
 * and every one of them failed the moment the constraint landed.
 *
 * That is the constraint working, and it is also the evidence CLAUDE.md §9.1
 * asks for: the check went red on real callers the first time it ran, without
 * anybody arranging for it to.
 *
 * The fixtures were not wrong to be terse — they are about watching, quizzing
 * and reporting, not about accreditation paperwork. So the paperwork lives
 * here, in one place, rather than being pasted into each of them where it
 * would drift apart the first time a mandatory field is added.
 *
 * ## Why COALESCE, and why the caller inserts a draft
 *
 * A suite that *cares* about a field sets it in its own INSERT and asserts on
 * it — `certificate-delivery` names its organiser and reads it back off the
 * PDF. `COALESCE` means this helper furnishes only what the fixture left null,
 * so calling it can never silently replace a value a test is asserting on.
 *
 * The caller inserts `status = 'draft'` because the constraint is checked per
 * row, per statement: an INSERT that lands `published` and incomplete is
 * refused before any UPDATE could fix it. Draft-then-publish is also what an
 * operator does, so the fixture and the product now agree about the order.
 */

import type { Pool } from "pg";
import { createSecretCipher } from "../../../src/shared/secret-cipher.js";

/**
 * A real 1×1 PNG. The certificate renderer checks magic bytes, so a byte
 * pattern here would move the failure to a place that has nothing to do with
 * this file.
 */
const PLACEHOLDER_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Synthetic. A real VNR identifies a real accredited event at a real
 * Ärztekammer and does not belong in a fixture.
 */
export const FIXTURE_VNR = "2760552025919300018";

/** What a suite passes to `EivService` when it wants the submission to succeed. */
export const FIXTURE_VNR_PASSWORD = "fixture-vnr-password";

/**
 * Real ciphertext under the suite's `SECRETS_KMS_KEY`, not a byte pattern.
 *
 * A fixture that stored `'\x00'::bytea` would satisfy the constraint and then
 * fail at decrypt time inside the EIV worker — a failure attributed to the
 * cipher rather than to the fixture that lied to it.
 */
export function fixtureVnrPasswordEnc(): Buffer {
  return createSecretCipher("test", process.env["SECRETS_KMS_KEY"]).encrypt(
    FIXTURE_VNR_PASSWORD,
  );
}

/**
 * Fill in whatever the fixture left unset, then publish.
 *
 * Returns nothing: a caller that wants to know what was stored should read the
 * row, because reading it back is the assertion and being told by the helper
 * is not.
 */
export async function publishAccredited(pool: Pool, courseId: string): Promise<void> {
  await pool.query(
    `UPDATE courses
        SET vnr                     = COALESCE(NULLIF(btrim(vnr), ''), $2),
            vnr_password_enc        = COALESCE(vnr_password_enc, $3),
            cme_category            = COALESCE(NULLIF(btrim(cme_category), ''), 'D'),
            accreditation_body      = COALESCE(NULLIF(btrim(accreditation_body), ''),
                                               'Ärztekammer Westfalen-Lippe'),
            organizer               = COALESCE(NULLIF(btrim(organizer), ''),
                                               'Fixture GmbH, Iserlohn'),
            event_location          = COALESCE(NULLIF(btrim(event_location), ''), 'online'),
            scientific_lead_name    = COALESCE(NULLIF(btrim(scientific_lead_name), ''),
                                               'Dr. med. Fixture'),
            certificate_issue_place = COALESCE(NULLIF(btrim(certificate_issue_place), ''),
                                               'Iserlohn'),
            stamp_image             = COALESCE(stamp_image, $4),
            stamp_image_mime        = COALESCE(stamp_image_mime, 'image/png'),
            signature_image         = COALESCE(signature_image, $4),
            signature_image_mime    = COALESCE(signature_image_mime, 'image/png'),
            status                  = 'published'
      WHERE id = $1`,
    [courseId, FIXTURE_VNR, fixtureVnrPasswordEnc(), PLACEHOLDER_IMAGE],
  );
}
