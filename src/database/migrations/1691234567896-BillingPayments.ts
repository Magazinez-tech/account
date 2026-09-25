import { MigrationInterface, QueryRunner } from 'typeorm';

const CURRENT_TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

/**
 * Invoice line details (plan, VAT breakdown, service period) and a payments table recording each
 * attempt at the payment gateway. An invoice can have several failed payments and at most one
 * that succeeded.
 */
export class BillingPayments1691234567896 implements MigrationInterface {
  name = 'BillingPayments1691234567896';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE invoices
        ADD COLUMN plan_id      uuid REFERENCES subscription_plans(id),
        ADD COLUMN description  varchar(200),
        ADD COLUMN subtotal     numeric(12,2),
        ADD COLUMN vat_rate     numeric(5,2),
        ADD COLUMN vat_amount   numeric(12,2),
        ADD COLUMN period_start timestamptz,
        ADD COLUMN period_end   timestamptz`);

    await q.query(`
      CREATE TABLE payments (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        invoice_id         uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        provider           varchar(30)  NOT NULL,
        provider_charge_id varchar(100) NOT NULL,
        amount             numeric(12,2) NOT NULL,
        currency           char(3) NOT NULL DEFAULT 'THB',
        status             varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
        failure_message    text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        updated_at         timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, provider_charge_id)
      )`);
    await q.query(`CREATE INDEX idx_payments_tenant ON payments(tenant_id)`);
    await q.query(`CREATE INDEX idx_payments_invoice ON payments(invoice_id)`);

    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO app_user`);
    await q.query(`ALTER TABLE payments ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON payments
        USING (tenant_id = ${CURRENT_TENANT})
        WITH CHECK (tenant_id = ${CURRENT_TENANT})`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE payments`);
    await q.query(`
      ALTER TABLE invoices
        DROP COLUMN plan_id, DROP COLUMN description, DROP COLUMN subtotal, DROP COLUMN vat_rate,
        DROP COLUMN vat_amount, DROP COLUMN period_start, DROP COLUMN period_end`);
  }
}
