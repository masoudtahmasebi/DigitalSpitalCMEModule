-- Database roles (P0-03), implementing ADR-0002.
--
-- Two roles, and the separation matters:
--
--   ds_migrator  owns the schema and runs migrations. The application never
--                connects as this role.
--   ds_app       used by the API. NOT a superuser, NOT BYPASSRLS, and NOT the
--                owner of any table.
--
-- The last point is the one that is easy to get wrong. A table owner bypasses
-- row-level security by default, so if the application role ever owned the
-- tables it would silently have no tenant isolation at all. `FORCE ROW LEVEL
-- SECURITY` in the migration closes that door, and keeping ownership with
-- ds_migrator means the door was never open.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_migrator') THEN
    CREATE ROLE ds_migrator LOGIN PASSWORD 'ds_migrator_dev' NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ds_app') THEN
    CREATE ROLE ds_app LOGIN PASSWORD 'ds_app_dev' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

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
