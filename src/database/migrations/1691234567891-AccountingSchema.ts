import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountingSchema1691234567891 implements MigrationInterface {
  name = 'AccountingSchema1691234567891';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE chart_of_accounts (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code       varchar(20)  NOT NULL,
        name       varchar(200) NOT NULL,
        type       varchar(20)  NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        parent_id  uuid REFERENCES chart_of_accounts(id),
        is_active  boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, code)
      )`);

    await q.query(`
      CREATE TABLE journal_entries (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        entry_no    integer NOT NULL,
        entry_date  date    NOT NULL,
        description text,
        reference   varchar(100),
        status      varchar(20) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'void')),
        created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, entry_no)
      )`);
    await q.query(`CREATE INDEX idx_journal_entries_tenant_date ON journal_entries(tenant_id, entry_date)`);

    await q.query(`
      CREATE TABLE journal_lines (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id       uuid NOT NULL REFERENCES chart_of_accounts(id),
        description      text,
        debit            numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
        credit           numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
        line_no          smallint NOT NULL,
        CHECK ((debit > 0) <> (credit > 0))
      )`);
    await q.query(`CREATE INDEX idx_journal_lines_entry ON journal_lines(journal_entry_id)`);
    await q.query(`CREATE INDEX idx_journal_lines_account ON journal_lines(tenant_id, account_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE journal_lines`);
    await q.query(`DROP TABLE journal_entries`);
    await q.query(`DROP TABLE chart_of_accounts`);
  }
}
