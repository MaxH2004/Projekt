-- Creates the database logins for an environment. Run once per database as
-- a superuser or a role with CREATEROLE, before the first deployment:
--
--   psql "$ADMIN_URL" -v owner_password="..." -v app_password="..." -v backup_password="..." -f infra/scripts/create-roles.sql
--
-- hv_owner owns the schema and runs migrations. hv_login is what the API and
-- the worker connect as: it may switch to hv_app (tenant data) and hv_auth
-- (identity) and nothing else; row-level security applies to both.
-- hv_backup reads everything for pg_dump: row-level security is forced on
-- every table, so even the owner sees no rows without a tenant set.
-- Passwords come from the command line and are never stored in the repository.

\set ON_ERROR_STOP on

-- Creates missing roles and sets every password, so running the script again
-- rotates the passwords.
SELECT 'CREATE ROLE hv_owner LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_owner') \gexec
SELECT format('ALTER ROLE hv_owner LOGIN PASSWORD %L', :'owner_password') \gexec

SELECT 'CREATE ROLE hv_login LOGIN NOINHERIT' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_login') \gexec
SELECT format('ALTER ROLE hv_login LOGIN NOINHERIT PASSWORD %L', :'app_password') \gexec

SELECT 'CREATE ROLE hv_backup LOGIN BYPASSRLS' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_backup') \gexec
SELECT format('ALTER ROLE hv_backup LOGIN BYPASSRLS PASSWORD %L', :'backup_password') \gexec
GRANT pg_read_all_data TO hv_backup;

-- The group roles are normally created by the first migration; create them
-- here too so the grants below work on an empty database.
SELECT 'CREATE ROLE hv_app NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_app') \gexec
SELECT 'CREATE ROLE hv_auth NOLOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hv_auth') \gexec

GRANT hv_app, hv_auth TO hv_login;
-- The owner grants table rights to the group roles in migrations.
GRANT hv_app, hv_auth TO hv_owner WITH ADMIN OPTION;

SELECT format('ALTER DATABASE %I OWNER TO hv_owner', current_database()) \gexec
ALTER SCHEMA public OWNER TO hv_owner;
-- btree_gist is needed by the first migration and must be created by a superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
