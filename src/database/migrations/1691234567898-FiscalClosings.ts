import { MigrationInterface, QueryRunner } from 'typeorm';

const CURRENT_TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

/**
 * Year-end closing. journal_entries.kind marks system-generated closing entries (they zero the
 * revenue and expense accounts into retained earnings); fiscal_closings records each closed
 * fiscal year, and the latest fiscal_year_end is the date through which the books are locked.
 */
export class FiscalClosings1691234567898 implements MigrationInterface {
  name = 'FiscalClosings1691234567898';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE journal_entries
        ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'closing'))`);

    await q.query(`
      CREATE TABLE fiscal_closings (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        fiscal_year_start date NOT NULL,
        fiscal_year_end   date NOT NULL,
        journal_entry_id  uuid REFERENCES journal_entries(id),
        net_income        numeric(18,2) NOT NULL DEFAULT 0,
        closed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, fiscal_year_end)
      )`);

    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_closings TO app_user`);
    await q.query(`ALTER TABLE fiscal_closings ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON fiscal_closings
        USING (tenant_id = ${CURRENT_TENANT})
        WITH CHECK (tenant_id = ${CURRENT_TENANT})`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE fiscal_closings`);
    await q.query(`ALTER TABLE journal_entries DROP COLUMN kind`);
  }
}
