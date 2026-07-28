-- Database roles (P0-03), implementing ADR-0002.
--
-- Three roles:
--
--   ds_migrator        owns the schema and runs migrations. The application
--                       never connects as this role.
--   ds_app              used by the API. NOT a superuser, NOT BYPASSRLS, and
--                       NOT the owner of any table.
--   ds_binding_resolver owns exactly one function
--                       (resolve_project_binding, see migration 0002) and
--                       nothing else. NOLOGIN — nothing ever connects as it.
--
-- The ds_app point is the one that is easy to get wrong. A table owner
-- bypasses row-level security by default, so if the application role ever
-- owned the tables it would silently have no tenant isolation at all. `FORCE
-- ROW LEVEL SECURITY` in the migration closes that door, and keeping
-- ownership with ds_migrator means the door was never open.
--
-- `ds_binding_resolver` is the one deliberate BYPASSRLS in this schema. FORCE
-- ROW LEVEL SECURITY applies to every owner, ds_migrator included, so the
-- SECURITY DEFINER function that resolves a project's tenant *before*
-- app.customer_id exists needs an owner that can actually see the row. Its
-- entire blast radius is documented in migration 0002 alongside the function
-- it owns. `GRANT ... TO ds_migrator` lets migrations reassign ownership to
-- it without needing superuser for that one ALTER.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_migrator') THEN
    CREATE ROLE ds_migrator LOGIN PASSWORD 'ds_migrator_dev' NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_app') THEN
    CREATE ROLE ds_app LOGIN PASSWORD 'ds_app_dev' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_binding_resolver') THEN
    CREATE ROLE ds_binding_resolver NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT ds_binding_resolver TO ds_migrator;

-- Postgres requires the TARGET of "ALTER ... OWNER TO" to hold CREATE on the
-- containing schema, independent of role membership -- membership alone is not
-- enough. Granting it is safe here: ds_binding_resolver is NOLOGIN (nothing
-- can ever connect as it to use the privilege directly), and CREATE only
-- permits adding new objects, not reading existing tenant data.
GRANT CREATE ON SCHEMA public TO ds_binding_resolver;

GRANT ALL ON DATABASE ds_education TO ds_migrator;
GRANT CONNECT ON DATABASE ds_education TO ds_app;

-- ds_migrator owns the public schema; ds_app may only use what it is granted.
ALTER SCHEMA public OWNER TO ds_migrator;
GRANT USAGE ON SCHEMA public TO ds_app;

-- Anything ds_migrator creates from here on is readable and writable by ds_app,
-- without ds_app ever owning it.
ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ds_app;

ALTER DEFAULT PRIVILEGES FOR ROLE ds_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ds_app;
