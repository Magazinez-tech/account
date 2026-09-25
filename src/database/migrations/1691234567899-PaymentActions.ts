import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the customer was asked to do for a payment (redirect to a hosted page, or scan a PromptPay
 * QR) and until when, so an open invoice's QR can be shown again after a page reload.
 */
export class PaymentActions1691234567899 implements MigrationInterface {
  name = 'PaymentActions1691234567899';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE payments
        ADD COLUMN action_type varchar(20) CHECK (action_type IN ('redirect', 'qr')),
        ADD COLUMN action_url  text,
        ADD COLUMN expires_at  timestamptz`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE payments DROP COLUMN action_type, DROP COLUMN action_url, DROP COLUMN expires_at`);
  }
}
