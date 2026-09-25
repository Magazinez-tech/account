import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { AuthUser } from '../auth/jwt-auth.guard';
import { fromSatang, toSatang } from '../common/money';
import { Invoice, Payment, Subscription, SubscriptionPlan, SystemConfig, Tenant } from '../database/entities';
import { TenantDb } from '../database/tenant-db.service';
import { addMonth, priceWithVat } from './billing-math';
import { PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';
import { subscriptionAccess } from './subscription-access';

const DAY_MS = 24 * 60 * 60 * 1000;
const INVOICE_DUE_DAYS = 7;

interface InvoiceRow {
  id: string;
  invoice_no: string;
  description: string | null;
  subtotal: string | null;
  vat_amount: string | null;
  amount: string;
  status: Invoice['status'];
  payment_status: string | null;
  issued_at: Date | null;
  paid_at: Date | null;
  period_start: Date | null;
  period_end: Date | null;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly db: TenantDb,
    private readonly config: ConfigService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // ---- Reads --------------------------------------------------------------

  private latestSubscription(m: EntityManager) {
    return m.getRepository(Subscription).findOne({ where: {}, order: { createdAt: 'DESC' } });
  }

  /** Visible to every member: drives the trial / read-only banner. */
  status(auth: AuthUser) {
    return this.db.run(auth.tenantId, (m) => this.statusIn(m));
  }

  private async statusIn(m: EntityManager) {
    const sub = await this.latestSubscription(m);
    const plan = sub ? await m.getRepository(SubscriptionPlan).findOneBy({ id: sub.planId }) : null;
    const access = subscriptionAccess(sub);
    return {
      ...access,
      plan: plan && { code: plan.code, name: plan.name, maxUsers: plan.maxUsers },
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      // Canceled but still inside the paid period.
      cancelAtPeriodEnd: access.status === 'active' && !!sub?.canceledAt,
    };
  }

  /** Admin billing page: status, plans with VAT-inclusive totals, invoice history. */
  overview(auth: AuthUser) {
    return this.db.run(auth.tenantId, async (m) => {
      const vatRate = await this.vatRate(m);
      const plans = await m.getRepository(SubscriptionPlan).find({ where: { isActive: true }, order: { priceMonthly: 'ASC' } });
      const invoices: InvoiceRow[] = await m.query(
        `SELECT i.*, (SELECT p.status FROM payments p WHERE p.invoice_id = i.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status
           FROM invoices i ORDER BY i.created_at DESC LIMIT 50`,
      );
      return {
        ...(await this.statusIn(m)),
        vatRate,
        plans: plans.map((p) => {
          const price = priceWithVat(toSatang(p.priceMonthly), vatRate);
          return {
            code: p.code,
            name: p.name,
            maxUsers: p.maxUsers,
            priceMonthly: fromSatang(price.subtotal),
            vatAmount: fromSatang(price.vat),
            total: fromSatang(price.total),
          };
        }),
        invoices: invoices.map((row) => ({
          id: row.id,
          invoiceNo: row.invoice_no,
          description: row.description,
          subtotal: Number(row.subtotal ?? row.amount),
          vatAmount: Number(row.vat_amount ?? 0),
          amount: Number(row.amount),
          status: row.status,
          paymentStatus: row.payment_status,
          issuedAt: row.issued_at,
          paidAt: row.paid_at,
          periodStart: row.period_start,
          periodEnd: row.period_end,
        })),
      };
    });
  }

  private async vatRate(m: EntityManager): Promise<number> {
    const row = await m.getRepository(SystemConfig).findOneBy({ key: 'vat_rate' });
    return Number(row?.value ?? 7);
  }

  // ---- Checkout -----------------------------------------------------------

  /**
   * Issues an invoice for one month of `planCode` and starts a charge at the gateway. Any earlier
   * unpaid invoice is voided, so there is only ever one open invoice to pay.
   */
  async checkout(auth: AuthUser, planCode: string) {
    const invoice = await this.db.run(auth.tenantId, async (m) => {
      const plan = await m.getRepository(SubscriptionPlan).findOneBy({ code: planCode, isActive: true });
      if (!plan) throw new BadRequestException('Unknown plan');

      await m.getRepository(Invoice).update({ status: 'open' }, { status: 'void' });

      const vatRate = await this.vatRate(m);
      const price = priceWithVat(toSatang(plan.priceMonthly), vatRate);
      const sub = await this.latestSubscription(m);

      // Serialize numbering per tenant, like journal entries.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1 || \':invoice\'))', [auth.tenantId]);
      const [{ next }] = await m.query(`SELECT count(*) + 1 AS next FROM invoices`);
      const now = new Date();

      return m.getRepository(Invoice).save({
        tenantId: auth.tenantId,
        subscriptionId: sub?.id ?? null,
        planId: plan.id,
        invoiceNo: `INV-${String(next).padStart(6, '0')}`,
        description: `แพ็กเกจ ${plan.name} 1 เดือน`,
        subtotal: fromSatang(price.subtotal).toFixed(2),
        vatRate: vatRate.toFixed(2),
        vatAmount: fromSatang(price.vat).toFixed(2),
        amount: fromSatang(price.total).toFixed(2),
        currency: plan.currency,
        status: 'open',
        issuedAt: now,
        dueAt: new Date(now.getTime() + INVOICE_DUE_DAYS * DAY_MS),
      });
    });

    // The gateway call happens outside the transaction; the open invoice is already committed.
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:5173');
    const charge = await this.gateway.createCharge({
      amountSatang: toSatang(invoice.amount),
      currency: invoice.currency,
      description: `${invoice.invoiceNo} ${invoice.description}`,
      returnUrl: `${appUrl}/billing?invoice=${invoice.id}`,
    });
    await this.db.run(auth.tenantId, (m) =>
      m.getRepository(Payment).insert({
        tenantId: auth.tenantId,
        invoiceId: invoice.id,
        provider: this.gateway.provider,
        providerChargeId: charge.chargeId,
        amount: invoice.amount,
        currency: invoice.currency,
        status: 'pending',
      }),
    );

    return { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, amount: Number(invoice.amount), redirectUrl: charge.authorizeUri };
  }

  // ---- Gateway results (webhook / mock) -----------------------------------

  /** Before the tenant is known, find the payment by the gateway's charge id (bypasses RLS). */
  private async paymentByCharge(chargeId: string) {
    const payment = await this.db.system
      .getRepository(Payment)
      .findOneBy({ provider: this.gateway.provider, providerChargeId: chargeId });
    if (!payment) throw new NotFoundException('Charge not found');
    return payment;
  }

  async chargeDetails(chargeId: string) {
    const payment = await this.paymentByCharge(chargeId);
    return this.db.run(payment.tenantId, async (m) => {
      const invoice = await m.getRepository(Invoice).findOneByOrFail({ id: payment.invoiceId });
      const tenant = await m.getRepository(Tenant).findOneByOrFail({ id: payment.tenantId });
      return {
        chargeId,
        status: payment.status,
        amount: Number(payment.amount),
        currency: payment.currency,
        description: `${invoice.invoiceNo} ${invoice.description ?? ''}`.trim(),
        merchantCustomer: tenant.name,
      };
    });
  }

  /**
   * Applies a gateway's final result for a charge. Idempotent: gateways retry webhooks, so a
   * payment that is no longer pending is left alone.
   */
  async settleCharge(chargeId: string, outcome: 'succeeded' | 'failed', failureMessage?: string) {
    const found = await this.paymentByCharge(chargeId);

    return this.db.run(found.tenantId, async (m) => {
      const [payment] = await m.query(`SELECT status FROM payments WHERE id = $1 FOR UPDATE`, [found.id]);
      if (payment.status !== 'pending') return { status: payment.status as string, alreadySettled: true };

      if (outcome === 'failed') {
        await m.getRepository(Payment).update(found.id, { status: 'failed', failureMessage: failureMessage ?? 'Payment failed' });
        return { status: 'failed', alreadySettled: false };
      }

      const invoice = await m.getRepository(Invoice).findOneByOrFail({ id: found.invoiceId });
      if (!invoice.planId) throw new ConflictException('Invoice has no plan');
      const sub = await this.latestSubscription(m);
      if (!sub) throw new ConflictException('Tenant has no subscription');

      // Paying early extends the current paid period; otherwise the new period starts now.
      const now = new Date();
      const stillPaid = subscriptionAccess(sub, now).status === 'active' && sub.currentPeriodEnd! > now;
      const periodStart = stillPaid ? sub.currentPeriodEnd! : now;
      const periodEnd = addMonth(periodStart);

      await m.getRepository(Payment).update(found.id, { status: 'succeeded' });
      await m.getRepository(Invoice).update(invoice.id, { status: 'paid', paidAt: now, periodStart, periodEnd });
      await m.getRepository(Subscription).update(sub.id, {
        status: 'active',
        planId: invoice.planId, // plan changes take effect immediately, without proration
        currentPeriodStart: stillPaid ? sub.currentPeriodStart : now,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      });
      await m.getRepository(Tenant).update(found.tenantId, { subscriptionStatus: 'active' });
      return { status: 'succeeded', alreadySettled: false };
    });
  }

  // ---- Cancel / resume ----------------------------------------------------

  /** Stops renewal; the tenant keeps full access until the paid period ends. */
  cancel(auth: AuthUser) {
    return this.db.run(auth.tenantId, async (m) => {
      const sub = await this.latestSubscription(m);
      if (!sub || subscriptionAccess(sub).status !== 'active') throw new BadRequestException('No active paid subscription to cancel');
      if (!sub.canceledAt) await m.getRepository(Subscription).update(sub.id, { canceledAt: new Date() });
      return this.statusIn(m);
    });
  }

  resume(auth: AuthUser) {
    return this.db.run(auth.tenantId, async (m) => {
      const sub = await this.latestSubscription(m);
      if (!sub || subscriptionAccess(sub).status !== 'active') throw new BadRequestException('No active paid subscription to resume');
      await m.getRepository(Subscription).update(sub.id, { canceledAt: null });
      return this.statusIn(m);
    });
  }
}
