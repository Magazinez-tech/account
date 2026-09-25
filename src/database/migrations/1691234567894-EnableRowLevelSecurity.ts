import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Row-Level Security for tenant isolation.
 *
 * The application connects as the migration user (a superuser in dev, which bypasses RLS)
 * and, for every tenant-scoped request, runs `SET LOCAL ROLE app_user` plus
 * `set_config('app.tenant_id', ...)` inside a transaction (see TenantDb). app_user is
 * not a superuser and does not own the tables, so these policies apply to it.
 */
const TENANT_TABLES = [
  'companies',
  'users',
  'roles',
  'user_roles',
  'chart_of_accounts',
  'journal_entries',
  'journal_lines',
  'subscriptions',
  'invoices',
];
const GLOBAL_READ_ONLY_TABLES = ['subscription_plans', 'system_config'];
const CURRENT_TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

export class EnableRowLevelSecurity1691234567894 implements MigrationInterface {
  name = 'EnableRowLevelSecurity1691234567894';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user NOLOGIN;
        END IF;
        EXECUTE format('GRANT app_user TO %I', current_user);
      END
      $$`);
    await q.query(`GRANT USAGE ON SCHEMA public TO app_user`);

    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO app_user`);
    await q.query(`ALTER TABLE tenants ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON tenants
        USING (id = ${CURRENT_TENANT})
        WITH CHECK (id = ${CURRENT_TENANT})`);

    for (const table of TENANT_TABLES) {
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_user`);
      await q.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = ${CURRENT_TENANT})
          WITH CHECK (tenant_id = ${CURRENT_TENANT})`);
    }

    for (const table of GLOBAL_READ_ONLY_TABLES) {
      await q.query(`GRANT SELECT ON ${table} TO app_user`);
      await q.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await q.query(`CREATE POLICY read_all ON ${table} FOR SELECT USING (true)`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of GLOBAL_READ_ONLY_TABLES) {
      await q.query(`DROP POLICY read_all ON ${table}`);
      await q.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    for (const table of ['tenants', ...TENANT_TABLES]) {
      await q.query(`DROP POLICY tenant_isolation ON ${table}`);
      await q.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    await q.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user`);
    await q.query(`REVOKE USAGE ON SCHEMA public FROM app_user`);
  }
}
