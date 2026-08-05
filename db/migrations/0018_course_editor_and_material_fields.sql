-- A fourth staff role, and the two Mediathek fields the layout has always
-- shown and the schema never had (P12-01b).
--
-- ## `course_editor`
--
-- "There should be customer users who can create departments and projects and
-- courses" — that is `customer_admin`. "There should be customer users who can
-- create only courses, so they have limited access" — that is this role, and
-- migration 0017's CHECK constraint had no room for it.
--
-- It is a *capability* distinction, not a scope one, which is why the rank
-- ordering in `@ds/domain/staff-identity` was not enough on its own: a
-- `course_editor` and a `department_admin` may sit in the same department and
-- still differ on whether they can create a project inside it. `CAPABILITIES`
-- there is the authority; this constraint only has to allow the row.
--
-- Its department is optional. An author working across a customer's whole
-- catalogue has no department; one hired for one therapeutic area does. Both
-- are legitimate, so the constraint permits either and the scope check in
-- `canGrant` handles the difference.
--
-- ## Material description and thumbnail
--
-- The Mediathek layout draws every material as a card with a thumbnail and a
-- paragraph of description. `contents` — which holds materials under
-- `kind = 'material'` — has `title`, `mime_type` and `file_size` and nothing to
-- put on either. The widget currently renders "PDF · 512 KB" in place of the
-- description and a grey placeholder in place of the image, with a comment
-- saying why. These two columns are what let it render what the layout asks
-- for.
--
-- `body` already exists on `contents` and is the description for a `text`
-- item. Reusing it for a material's description would overload one column with
-- two meanings — the long-form body of a text lesson and a two-line caption —
-- and the first author to paste an article into a material card would find out.

BEGIN;

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

ALTER TABLE admin_user_roles
    DROP CONSTRAINT admin_user_roles_scope_matches_role;

ALTER TABLE admin_user_roles
    DROP CONSTRAINT admin_user_roles_role_check;

ALTER TABLE admin_user_roles
    ADD CONSTRAINT admin_user_roles_role_check
    CHECK (role IN ('super_admin', 'customer_admin', 'department_admin', 'course_editor'));

ALTER TABLE admin_user_roles
    ADD CONSTRAINT admin_user_roles_scope_matches_role CHECK (
        (role = 'super_admin'      AND customer_id IS NULL     AND department_id IS NULL) OR
        (role = 'customer_admin'   AND customer_id IS NOT NULL AND department_id IS NULL) OR
        (role = 'department_admin' AND customer_id IS NOT NULL AND department_id IS NOT NULL) OR
        -- Department optional: an author may work across a customer's whole
        -- catalogue or be confined to one area.
        (role = 'course_editor'    AND customer_id IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- Material presentation
-- ---------------------------------------------------------------------------

ALTER TABLE contents
    ADD COLUMN description  text,
    ADD COLUMN thumbnail_url text;

COMMENT ON COLUMN contents.description IS
    'Short caption for a Mediathek card. Distinct from `body`, which is a text lesson''s long-form content.';
COMMENT ON COLUMN contents.thumbnail_url IS
    'Card image for a Mediathek material. NULL renders the placeholder rather than collapsing the card.';

-- `contents` carries FORCE ROW LEVEL SECURITY and `ds_migrator` is the owner
-- without BYPASSRLS (ADR-0002), so a data-touching statement here would see
-- zero rows — the trap migration 0016 documents at length. These two are pure
-- `ADD COLUMN` with no backfill, so nothing needs disabling: an added column is
-- catalogue work, not a row read.
--
-- Asserted anyway, because "this migration did not need the workaround" is
-- exactly the belief that is wrong the one time it matters.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class
         WHERE relname = 'contents' AND relrowsecurity AND relforcerowsecurity
    ) THEN
        RAISE EXCEPTION
            'contents left without FORCE ROW LEVEL SECURITY — refusing to commit';
    END IF;
END $$;

COMMIT;
