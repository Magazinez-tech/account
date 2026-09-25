import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1691234567890 implements MigrationInterface {
  name = 'InitialSchema1691234567890';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE tenants (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                varchar(200) NOT NULL,
        slug                varchar(100) NOT NULL UNIQUE,
        subscription_status varchar(30)  NOT NULL DEFAULT 'trialing',
        created_at          timestamptz  NOT NULL DEFAULT now(),
        updated_at          timestamptz  NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE companies (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name                    varchar(200) NOT NULL,
        tax_id                  varchar(20),
        address                 text,
        currency                char(3)  NOT NULL DEFAULT 'THB',
        fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
        created_at              timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_companies_tenant ON companies(tenant_id)`);

    await q.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email         varchar(255) NOT NULL,
        full_name     varchar(200) NOT NULL,
        password_hash varchar(255) NOT NULL,
        is_active     boolean NOT NULL DEFAULT true,
        last_login_at timestamptz,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, email)
      )`);

    await q.query(`
      CREATE TABLE roles (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name        varchar(50) NOT NULL,
        description text,
        is_system   boolean NOT NULL DEFAULT false,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, name)
      )`);

    await q.query(`
      CREATE TABLE user_roles (
        user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, role_id)
      )`);
    await q.query(`CREATE INDEX idx_user_roles_tenant ON user_roles(tenant_id)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE user_roles`);
    await q.query(`DROP TABLE roles`);
    await q.query(`DROP TABLE users`);
    await q.query(`DROP TABLE companies`);
    await q.query(`DROP TABLE tenants`);
  }
}
