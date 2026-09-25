import { MigrationInterface, QueryRunner } from 'typeorm';

const CURRENT_TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const NEW_TABLES = ['customers', 'sales_documents', 'sales_document_lines'];

/**
 * Company profile (issuer details printed on documents), customers, and sales documents:
 * quotations and billing notes share one table (doc_type) and one line table.
 *
 * Customer details are copied onto the document when it is saved, so editing a customer later
 * doesn't change documents already sent. Billing notes post journal entries of kind 'sales'
 * (on issue: AR / revenue / output VAT; on payment: cash / AR), reversed only by voiding the note.
 */
export class SalesDocuments1691234567900 implements MigrationInterface {
  name = 'SalesDocuments1691234567900';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE companies
        ADD COLUMN branch_code varchar(5) NOT NULL DEFAULT '00000' CHECK (branch_code ~ '^[0-9]{5}$'),
        ADD COLUMN phone       varchar(50),
        ADD COLUMN email       varchar(200),
        ADD COLUMN website     varchar(200)`);

    await q.query(`
      CREATE TABLE customers (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name         varchar(200) NOT NULL,
        tax_id       varchar(13) CHECK (tax_id ~ '^[0-9]{13}$'),
        branch_code  varchar(5) CHECK (branch_code ~ '^[0-9]{5}$'),
        address      text,
        contact_name varchar(200),
        phone        varchar(50),
        email        varchar(200),
        credit_days  smallint NOT NULL DEFAULT 30 CHECK (credit_days BETWEEN 0 AND 365),
        notes        text,
        is_active    boolean NOT NULL DEFAULT true,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX customers_tenant_name ON customers (tenant_id, name)`);

    await q.query(`
      ALTER TABLE journal_entries
        DROP CONSTRAINT journal_entries_kind_check,
        ADD CONSTRAINT journal_entries_kind_check CHECK (kind IN ('manual', 'closing', 'sales'))`);

    await q.query(`
      CREATE TABLE sales_documents (
        id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        doc_type                 varchar(20) NOT NULL CHECK (doc_type IN ('quotation', 'billing_note')),
        doc_no                   varchar(30) NOT NULL,
        status                   varchar(20) NOT NULL,
        customer_id              uuid NOT NULL REFERENCES customers(id),
        customer_name            varchar(200) NOT NULL,
        customer_tax_id          varchar(13),
        customer_branch_code     varchar(5),
        customer_address         text,
        customer_contact_name    varchar(200),
        doc_date                 date NOT NULL,
        due_date                 date,
        reference                varchar(100),
        notes                    text,
        vat_rate                 numeric(5,2) NOT NULL,
        subtotal                 numeric(18,2) NOT NULL,
        discount                 numeric(18,2) NOT NULL DEFAULT 0,
        vat_amount               numeric(18,2) NOT NULL,
        total                    numeric(18,2) NOT NULL,
        source_document_id       uuid REFERENCES sales_documents(id),
        revenue_account_id       uuid REFERENCES chart_of_accounts(id),
        journal_entry_id         uuid REFERENCES journal_entries(id),
        paid_date                date,
        payment_account_id       uuid REFERENCES chart_of_accounts(id),
        payment_journal_entry_id uuid REFERENCES journal_entries(id),
        created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at               timestamptz NOT NULL DEFAULT now(),
        updated_at               timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, doc_type, doc_no),
        CHECK (
          (doc_type = 'quotation'    AND status IN ('draft', 'sent', 'accepted', 'rejected', 'void')) OR
          (doc_type = 'billing_note' AND status IN ('draft', 'issued', 'paid', 'void'))
        ),
        CHECK (discount >= 0 AND discount <= subtotal)
      )`);
    await q.query(`CREATE INDEX sales_documents_list ON sales_documents (tenant_id, doc_type, doc_date DESC)`);
    // A quotation is billed at most once (a voided billing note frees it again).
    await q.query(`
      CREATE UNIQUE INDEX sales_documents_one_bill_per_quotation
        ON sales_documents (source_document_id) WHERE status <> 'void'`);

    await q.query(`
      CREATE TABLE sales_document_lines (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
        line_no     smallint NOT NULL,
        description text NOT NULL,
        quantity    numeric(14,2) NOT NULL CHECK (quantity > 0),
        unit        varchar(30),
        unit_price  numeric(18,2) NOT NULL CHECK (unit_price >= 0),
        amount      numeric(18,2) NOT NULL,
        UNIQUE (document_id, line_no)
      )`);

    for (const table of NEW_TABLES) {
      await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_user`);
      await q.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = ${CURRENT_TENANT})
          WITH CHECK (tenant_id = ${CURRENT_TENANT})`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE sales_document_lines`);
    await q.query(`DROP TABLE sales_documents`);
    await q.query(`DROP TABLE customers`);
    await q.query(`UPDATE journal_entries SET kind = 'manual' WHERE kind = 'sales'`);
    await q.query(`
      ALTER TABLE journal_entries
        DROP CONSTRAINT journal_entries_kind_check,
        ADD CONSTRAINT journal_entries_kind_check CHECK (kind IN ('manual', 'closing'))`);
    await q.query(`ALTER TABLE companies DROP COLUMN branch_code, DROP COLUMN phone, DROP COLUMN email, DROP COLUMN website`);
  }
}
