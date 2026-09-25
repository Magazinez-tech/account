import { MigrationInterface, QueryRunner } from 'typeorm';

export class BillingSchema1691234567892 implements MigrationInterface {
  name = 'BillingSchema1691234567892';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE subscription_plans (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code          varchar(50)  NOT NULL UNIQUE,
        name          varchar(100) NOT NULL,
        price_monthly numeric(12,2) NOT NULL,
        currency      char(3) NOT NULL DEFAULT 'THB',
        max_users     integer,
        max_companies integer,
        features      jsonb   NOT NULL DEFAULT '{}',
        is_active     boolean NOT NULL DEFAULT true,
        created_at    timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE subscriptions (
        id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id              uuid NOT NULL REFERENCES subscription_plans(id),
        status               varchar(30) NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled')),
        trial_ends_at        timestamptz,
        current_period_start timestamptz,
        current_period_end   timestamptz,
        canceled_at          timestamptz,
        created_at           timestamptz NOT NULL DEFAULT now(),
        updated_at           timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id)`);

    await q.query(`
      CREATE TABLE invoices (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
        invoice_no      varchar(50)   NOT NULL,
        amount          numeric(12,2) NOT NULL,
        currency        char(3) NOT NULL DEFAULT 'THB',
        status          varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'void')),
        issued_at       timestamptz,
        due_at          timestamptz,
        paid_at         timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, invoice_no)
      )`);

    await q.query(`
      INSERT INTO subscription_plans (code, name, price_monthly, max_users, max_companies, features) VALUES
        ('starter',  'Starter',   290.00,    3,    1, '{"reports": ["trial_balance"]}'),
        ('pro',      'Pro',       790.00,   10,    3, '{"reports": ["trial_balance", "financial_statements"]}'),
        ('business', 'Business', 1990.00, NULL, NULL, '{"reports": ["trial_balance", "financial_statements"], "api_access": true}')
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE invoices`);
    await q.query(`DROP TABLE subscriptions`);
    await q.query(`DROP TABLE subscription_plans`);
  }
}
