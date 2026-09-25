import { MigrationInterface, QueryRunner } from 'typeorm';

export class SystemConfigSchema1691234567893 implements MigrationInterface {
  name = 'SystemConfigSchema1691234567893';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE system_config (
        key         varchar(100) PRIMARY KEY,
        value       jsonb NOT NULL,
        description text,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      INSERT INTO system_config (key, value, description) VALUES
        ('trial_days',        '14',          'Length of the free trial for new tenants, in days'),
        ('default_plan',      '"starter"',   'Plan code assigned to new tenants'),
        ('default_currency',  '"THB"',       'Default currency for new companies'),
        ('vat_rate',          '7',           'Thai VAT rate in percent')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE system_config`);
  }
}
