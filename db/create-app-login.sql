-- Creates (or updates) the least-privilege login role the API uses in production.
-- Run once per database as a superuser, after `npm run migration:run` (which creates app_user and app_system):
--
--   psql -U postgres -d <database> -v login=accounting_app -v password='<strong password>' -f db/create-app-login.sql
--
-- Then run the API with DB_USERNAME=accounting_app. Keep running migrations as the owner (e.g. postgres).
-- Requires PostgreSQL 16+ (GRANT ... WITH INHERIT FALSE, SET TRUE).
\set ON_ERROR_STOP on

-- Not a superuser and no BYPASSRLS: row-level security always applies to this role.
SELECT format('CREATE ROLE %I LOGIN', :'login')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'login') \gexec
SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'login', :'password') \gexec

-- Lookups before the tenant is known (slug, invite token, payment charge) and the login lockout table.
GRANT app_system TO :"login";

-- May SET ROLE app_user inside tenant transactions (TenantDb.run) but inherits none of its privileges,
-- so a query outside TenantDb.run cannot read tenant tables at all.
GRANT app_user TO :"login" WITH INHERIT FALSE, SET TRUE;

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'login') \gexec
GRANT USAGE ON SCHEMA public TO :"login";

-- What the role ended up with:
SELECT r.rolname, r.rolsuper, r.rolbypassrls,
       pg_has_role(r.rolname, 'app_user', 'SET')    AS can_set_app_user,
       pg_has_role(r.rolname, 'app_user', 'USAGE')  AS inherits_app_user,
       pg_has_role(r.rolname, 'app_system', 'USAGE') AS inherits_app_system
  FROM pg_roles r WHERE r.rolname = :'login';
