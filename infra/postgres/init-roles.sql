-- Database roles (P0-03), implementing ADR-0002.
--
-- Six roles:
--
--   ds_migrator        owns the schema and runs migrations. The application
--                       never connects as this role.
--   ds_app              used by the API. NOT a superuser, NOT BYPASSRLS, and
--                       NOT the owner of any table.
--   ds_binding_resolver owns the pre-authentication lookups (migrations 0002,
--                       0007, 0008) and nothing else. NOLOGIN.
--   ds_erasure          owns exactly one function, `erase_subject` (migration
--                       0009), and nothing else. NOLOGIN.
--   ds_customer_registry owns exactly one function,
--                       `list_customer_registry` (migration 0021), and
--                       nothing else. NOLOGIN.
--   ds_merge            owns exactly two functions, `participant_merge_side`
--                       and `merge_participants` (migration 0033), and nothing
--                       else. NOLOGIN.
--
-- The ds_app point is the one that is easy to get wrong. A table owner
-- bypasses row-level security by default, so if the application role ever
-- owned the tables it would silently have no tenant isolation at all. `FORCE
-- ROW LEVEL SECURITY` in the migration closes that door, and keeping
-- ownership with ds_migrator means the door was never open.
--
-- BYPASSRLS appears exactly four times, and each is deliberate. FORCE ROW LEVEL
-- SECURITY applies to every owner, ds_migrator included, so a SECURITY DEFINER
-- function that has to act outside a tenant context needs an owner that can
-- see the rows at all.
--
--   ds_binding_resolver  resolves a project's tenant *before* app.customer_id
--                        exists — the chicken-and-egg at the start of every
--                        request. Blast radius documented in migration 0002.
--   ds_erasure           performs a GDPR Art. 17 erasure, which is inherently
--                        cross-tenant: one physician has one EFN and may hold
--                        enrolments at several customers. Blast radius
--                        documented in migration 0009.
--   ds_customer_registry lists the customers a super administrator may act on.
--                        `customers` is RLS-scoped to one tenant, so no
--                        tenant-scoped role can enumerate it — and a platform
--                        operator's first screen is that list. Returns registry
--                        metadata and child counts only, never tenant content.
--                        Blast radius documented in migration 0021.
--   ds_merge             merges two credentials onto one person (P21-05). The
--                        whole point of the operation is a physician who exists
--                        in two places, and those two places are frequently two
--                        customers — so every row it reads and every row it
--                        moves is, by construction, outside whichever tenant
--                        context the request carries. It is reachable only from
--                        a `super_admin` route. Blast radius documented in
--                        migration 0033.
--
-- Note what is NOT on this list: creating, renaming and deleting a customer.
-- Those name a single customer, so they run as ds_app inside that customer's
-- own tenant context and pay full RLS like any other write. Only the
-- enumeration is inherently cross-tenant, so only the enumeration is exempt.
--
-- None can be connected as, none is granted to ds_app, and each owns one fixed
-- function whose whole body is in a reviewed migration. `GRANT ... TO
-- ds_migrator` lets migrations reassign ownership without needing superuser
-- for that one ALTER.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_migrator') THEN
    CREATE ROLE ds_migrator LOGIN PASSWORD 'ds_migrator_dev' NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_app') THEN
    CREATE ROLE ds_app LOGIN PASSWORD 'ds_app_dev' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  /*
   * `ds_schema_reader` — one table, SELECT only, nothing else (P149-01).
   *
   * It exists so an entrypoint running as the application can ask "is this
   * database migrated?" without either widening `ds_app` or being handed the
   * migrator's credentials.
   *
   * P148-01 is why. `bootstrap-admin` was given `assertSchemaCurrent`, which
   * reads `schema_migrations`, and the documented invocation runs in the
   * `api` service where `MIGRATION_DATABASE_URL` is not set and must not be.
   * The platform's first-boot command became a hard failure on every fresh
   * host.
   *
   * Note what this file itself does further down, because P148 and P149 both
   * got it wrong: `ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator … TO ds_app`
   * gives `ds_app` SELECT/INSERT/UPDATE/DELETE on every table the migrator
   * creates, `schema_migrations` included. `ds_app` can therefore read the
   * ledger — and rewrite it. Narrowing that is a decision of its own
   * (docs/backlog/P151.md); it is not what this role is here to work around.
   *
   * The two obvious fixes were both refused by a human: resting the check on
   * `ds_app` rests it on the application role's privileges, and handing the api
   * container the migrator's URL gives a request-serving process the ability to
   * rewrite the schema. This is the third option — a role that can do exactly
   * one harmless thing.
   *
   * `LOGIN`, because it is connected as. `NOBYPASSRLS NOSUPERUSER NOCREATEDB
   * NOCREATEROLE`, like `ds_app`, and it is granted nothing anywhere else: the
   * single `GRANT SELECT ON schema_migrations` lives in migration 0049. If that
   * grant were ever dropped the check fails closed, which is the behaviour
   * `bootstrap-admin` wants.
   */
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_schema_reader') THEN
    CREATE ROLE ds_schema_reader LOGIN PASSWORD 'ds_schema_reader_dev'
      NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_binding_resolver') THEN
    CREATE ROLE ds_binding_resolver NOLOGIN BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_erasure') THEN
    CREATE ROLE ds_erasure NOLOGIN BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_merge') THEN
    CREATE ROLE ds_merge NOLOGIN BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_customer_registry') THEN
    CREATE ROLE ds_customer_registry NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Passwords
-- ---------------------------------------------------------------------------
--
-- The literals above are development credentials, and they are in the
-- repository on purpose: `infra/docker-compose.yml`, the CI job and
-- `.env.example` all use them, and a local database with a secret nobody can
-- read is a local database nobody can use.
--
-- They must never be what production runs with. This file is mounted into
-- `docker-entrypoint-initdb.d`, so without the block below a production
-- database would come up with two login roles whose passwords are published on
-- GitHub, and `DS_APP_PASSWORD` from the deployment secrets would go
-- unused — the API would fail to connect and somebody would "fix" it by
-- putting the dev password in the env file.
--
-- So: when the environment supplies a password, it wins. `\getenv` leaves the
-- psql variable unset when the environment variable is absent, which is what
-- `:{?…}` tests — a local run sets neither and keeps the dev values.
--
-- `:'name'` is psql's quoting form and is not string interpolation: the value
-- is escaped as a literal by psql itself.

\getenv ds_migrator_password DS_MIGRATOR_PASSWORD
\getenv ds_app_password DS_APP_PASSWORD
\getenv ds_schema_reader_password DS_SCHEMA_READER_PASSWORD

\if :{?ds_migrator_password}
ALTER ROLE ds_migrator PASSWORD :'ds_migrator_password';
\endif

\if :{?ds_app_password}
ALTER ROLE ds_app PASSWORD :'ds_app_password';
\endif

-- The third login role (P149-01). Without this line the role would come up on
-- production holding `ds_schema_reader_dev`, which is published in this file,
-- and `DS_SCHEMA_READER_PASSWORD` from the deployment secrets would go unused —
-- exactly the failure the paragraph above describes, repeated for a new role
-- because somebody added the CREATE and not the ALTER.
\if :{?ds_schema_reader_password}
ALTER ROLE ds_schema_reader PASSWORD :'ds_schema_reader_password';
\endif

GRANT ds_binding_resolver TO ds_migrator;
GRANT ds_erasure TO ds_migrator;
GRANT ds_customer_registry TO ds_migrator;
GRANT ds_merge TO ds_migrator;

-- Postgres requires the TARGET of "ALTER ... OWNER TO" to hold CREATE on the
-- containing schema, independent of role membership -- membership alone is not
-- enough. Granting it is safe here: ds_binding_resolver is NOLOGIN (nothing
-- can ever connect as it to use the privilege directly), and CREATE only
-- permits adding new objects, not reading existing tenant data.
GRANT CREATE ON SCHEMA public TO ds_binding_resolver;
GRANT CREATE ON SCHEMA public TO ds_erasure;
GRANT CREATE ON SCHEMA public TO ds_customer_registry;
GRANT CREATE ON SCHEMA public TO ds_merge;

-- On **this** database, whichever it is.
--
-- These two lines named `ds_education` literally, and `POSTGRES_DB` is a
-- documented, configurable variable in `config.env.example`. Any deployment
-- that set it to anything else failed here: `GRANT ... ON DATABASE ds_education`
-- against a cluster that has no such database is an error, and `deploy.sh` runs
-- this with `ON_ERROR_STOP=1` — so the deploy aborted at "Ensuring database
-- roles" with a message about a database nobody had asked for.
--
-- The subtler half is worse. Had the error been suppressed, the grants would
-- have landed on a database the API never connects to, and the real one would
-- have kept PostgreSQL's default of `CONNECT` to `PUBLIC` — the restriction
-- this file exists to apply, silently not applied.
--
-- `current_database()` cannot drift from `POSTGRES_DB`, because it does not
-- read it: it is whichever database psql was pointed at, in the deploy and in
-- `docker-entrypoint-initdb.d` alike. `%I` quotes it as an identifier.
SELECT format('GRANT ALL ON DATABASE %I TO ds_migrator', current_database())
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO ds_app', current_database())
\gexec

-- ds_migrator owns the public schema; ds_app may only use what it is granted.
ALTER SCHEMA public OWNER TO ds_migrator;
GRANT USAGE ON SCHEMA public TO ds_app;

-- Anything ds_migrator creates from here on is readable and writable by ds_app,
-- without ds_app ever owning it.
ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ds_app;

ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ds_app;
