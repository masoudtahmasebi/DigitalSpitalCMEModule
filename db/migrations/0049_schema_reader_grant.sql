-- The one grant `ds_schema_reader` holds (P149-01).
--
-- ## Why this role exists at all
--
-- P148-01: `bootstrap-admin` was given `assertSchemaCurrent`, which reads
-- `schema_migrations`. `ds_app` holds no grant on that table — deliberately,
-- ADR-0002, the application role owns nothing — and the documented invocation
--
--     docker compose run --rm --entrypoint node api dist/bootstrap-admin.js
--
-- runs in the `api` service, where `MIGRATION_DATABASE_URL` is not set and must
-- not be. So the platform's first-boot command failed on every fresh host, and
-- the change was reverted.
--
-- Two fixes were available and a human refused both: granting `ds_app` the read
-- widens the application role for a diagnostic, and giving the api container the
-- migrator's URL hands a request-serving process the ability to rewrite the
-- schema. This is the third: a login role that can do exactly one harmless
-- thing and is granted nothing else anywhere.
--
-- ## Why the grant is here and not in init-roles.sql
--
-- `schema_migrations` does not exist when `init-roles.sql` runs on a fresh
-- database — the migrator creates it, `packages/migrator/src/index.ts:150`,
-- on its first run. A grant there would fail on exactly the installation this
-- exists for. `deploy.sh` applies roles first, then migrations, so by the time
-- this file runs the role exists and the table does.
--
-- ## Why SELECT and nothing else
--
-- The role never writes, and it must never be able to. There is no
-- `GRANT USAGE ON SCHEMA` beyond what `PUBLIC` already has, no sequence grant,
-- no default privileges. If somebody later needs this role to read a second
-- table, that is a review, not a convenience — the whole argument for its
-- existence is that its blast radius is one `SELECT`.
--
-- If this grant is ever dropped, `assertSchemaCurrent` fails closed and
-- `bootstrap-admin` refuses to run. That is the behaviour we want there: a
-- first-boot command that cannot verify the schema should stop, because nothing
-- downstream of it is time-critical. `subject-erasure` takes the opposite
-- decision for the opposite reason — see P149-02.

BEGIN;

GRANT SELECT ON schema_migrations TO ds_schema_reader;

COMMIT;
