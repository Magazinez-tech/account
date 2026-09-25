import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Least-privilege setup for production.
 *
 * app_system (NOLOGIN) holds the only rights the API needs outside a tenant transaction: the
 * lookups that happen before the tenant is known (slug -> tenant, invite token -> invitation,
 * gateway charge -> payment) and the login lockout table. Its access to tenant tables goes through
 * RLS policies written for app_system alone, so no role needs BYPASSRLS.
 *
 * The production login role (db/create-app-login.sql) inherits app_system and may SET ROLE app_user
 * without inheriting app_user's privileges: a query that forgets TenantDb.run gets "permission
 * denied" instead of another tenant's rows.
 */
const LOOKUPS: { table: string; privileges: string }[] = [
  { table: 'tenants', privileges: 'SELECT' },
  { table: 'user_invitations', privileges: 'SELECT' },
  { table: 'payments', privileges: 'SELECT' },
];

export class SystemRoleAndLoginLockouts1691234567897 implements MigrationInterface {
  name = 'SystemRoleAndLoginLockouts1691234567897';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
          CREATE ROLE app_system NOLOGIN;
        END IF;
      END
      $$`);
    await q.query(`GRANT USAGE ON SCHEMA public TO app_system`);

    for (const { table, privileges } of LOOKUPS) {
      await q.query(`GRANT ${privileges} ON ${table} TO app_system`);
      await q.query(`CREATE POLICY system_lookup ON ${table} FOR SELECT TO app_system USING (true)`);
    }

    // Failed-login counters keyed by tenant + email. Global (not tenant data), shared by all API
    // instances. RLS is on so app_user can't touch it; app_system gets a policy.
    await q.query(`
      CREATE TABLE login_lockouts (
        key             varchar(320) PRIMARY KEY,
        failures        integer     NOT NULL DEFAULT 0,
        window_start    timestamptz NOT NULL DEFAULT now(),
        locked_until    timestamptz
      )`);
    await q.query(`ALTER TABLE login_lockouts ENABLE ROW LEVEL SECURITY`);
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON login_lockouts TO app_system`);
    await q.query(`CREATE POLICY system_access ON login_lockouts TO app_system USING (true) WITH CHECK (true)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE login_lockouts`);
    for (const { table, privileges } of LOOKUPS) {
      await q.query(`DROP POLICY system_lookup ON ${table}`);
      await q.query(`REVOKE ${privileges} ON ${table} FROM app_system`);
    }
    await q.query(`REVOKE USAGE ON SCHEMA public FROM app_system`);
    // The role itself is left in place: it is cluster-wide and a login role may still be a member.
  }
}
