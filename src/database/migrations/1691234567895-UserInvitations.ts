import { MigrationInterface, QueryRunner } from 'typeorm';

const CURRENT_TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

/**
 * Invitations for adding users to a tenant. Only a SHA-256 hash of the invite token is stored;
 * the raw token exists only in the link the admin shares.
 */
export class UserInvitations1691234567895 implements MigrationInterface {
  name = 'UserInvitations1691234567895';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE user_invitations (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email       varchar(255) NOT NULL,
        full_name   varchar(200) NOT NULL,
        role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        token_hash  char(64) NOT NULL UNIQUE,
        invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
        expires_at  timestamptz NOT NULL,
        accepted_at timestamptz,
        revoked_at  timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_user_invitations_tenant ON user_invitations(tenant_id)`);
    // At most one open invitation per email per tenant.
    await q.query(`
      CREATE UNIQUE INDEX uq_user_invitations_pending ON user_invitations(tenant_id, email)
        WHERE accepted_at IS NULL AND revoked_at IS NULL`);

    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON user_invitations TO app_user`);
    await q.query(`ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON user_invitations
        USING (tenant_id = ${CURRENT_TENANT})
        WITH CHECK (tenant_id = ${CURRENT_TENANT})`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE user_invitations`);
  }
}
