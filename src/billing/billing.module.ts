import { Body, Controller, Get, HttpCode, Module, NotFoundException, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../auth/authenticated.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { CheckoutDto, MockCompleteDto, SimulatePaymentDto } from './billing.dto';
import { BillingService } from './billing.service';
import { OmisePaymentGateway } from './omise-gateway';
import { MockPaymentGateway, PAYMENT_GATEWAY, PaymentGateway } from './payment-gateway';

@ApiTags('Billing')
@Controller('billing')
@Authenticated({ allowWhenReadOnly: true }) // a locked-out tenant must still be able to pay
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Subscription state for any member: status, plan, dates and whether the tenant is read-only. */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.billing.status(user);
  }

  /** Billing page data: status, plans with VAT-inclusive prices, and the last 50 invoices. */
  @Get()
  @Roles('Admin')
  overview(@CurrentUser() user: AuthUser) {
    return this.billing.overview(user);
  }

  /**
   * Issue an invoice for one month of a plan (VAT added) and start a charge at the payment gateway.
   * `payment` says how to pay: `redirect` (hosted page; the gateway returns to `APP_URL/billing?invoice=<id>`)
   * or `qr` (PromptPay: show `imageUrl` and poll POST /billing/invoices/{id}/refresh). Voids any earlier
   * unpaid invoice.
   */
  @Post('checkout')
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'Unknown plan' })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.billing.checkout(user, dto.planCode);
  }

  /**
   * Re-check the invoice's latest payment with the gateway and settle it if final. The billing page
   * polls this while a PromptPay QR is shown, so payment is picked up even if the webhook is late.
   */
  @Post('invoices/:invoiceId/refresh')
  @HttpCode(200)
  @Roles('Admin')
  refresh(@CurrentUser() user: AuthUser, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.billing.refreshInvoicePayment(user, invoiceId);
  }

  /** Test mode only: make the gateway mark the invoice's pending charge paid or failed (Omise mark_as_paid / mark_as_failed). */
  @Post('invoices/:invoiceId/simulate')
  @HttpCode(200)
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'Gateway is not in test mode' })
  simulate(@CurrentUser() user: AuthUser, @Param('invoiceId', ParseUUIDPipe) invoiceId: string, @Body() dto: SimulatePaymentDto) {
    return this.billing.simulateInvoicePayment(user, invoiceId, dto.outcome);
  }

  /** Stop renewal. Access continues until the end of the paid period. */
  @Post('cancel')
  @HttpCode(200)
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'No active paid subscription' })
  cancel(@CurrentUser() user: AuthUser) {
    return this.billing.cancel(user);
  }

  /** Undo a cancel while the paid period is still running. */
  @Post('resume')
  @HttpCode(200)
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'No active paid subscription' })
  resume(@CurrentUser() user: AuthUser) {
    return this.billing.resume(user);
  }
}

/**
 * Stands in for the payment provider's hosted page and webhook. Public, like a real webhook;
 * the unguessable charge id is the only handle. Returns 404 unless PAYMENT_PROVIDER=mock.
 */
@ApiTags('Billing: mock gateway (dev only)')
@Controller('billing/mock/charges')
export class MockGatewayController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  private assertMock() {
    if (this.config.get('PAYMENT_PROVIDER', 'mock') !== 'mock') throw new NotFoundException();
  }

  /** Charge details for the mock checkout page. */
  @Get(':chargeId')
  @ApiNotFoundResponse({ description: 'Unknown charge, or PAYMENT_PROVIDER is not mock' })
  details(@Param('chargeId') chargeId: string) {
    this.assertMock();
    return this.billing.chargeDetails(chargeId);
  }

  /** Report the charge's outcome, as a real gateway's webhook would. Idempotent. */
  @Post(':chargeId/complete')
  @HttpCode(200)
  @ApiNotFoundResponse({ description: 'Unknown charge, or PAYMENT_PROVIDER is not mock' })
  complete(@Param('chargeId') chargeId: string, @Body() dto: MockCompleteDto) {
    this.assertMock();
    return this.billing.settleCharge(chargeId, dto.outcome, dto.failureMessage);
  }
}

/**
 * Payment provider webhooks (public). The payload is only a hint: the charge's state is re-read
 * from the provider's API with the secret key before anything is settled, so forged events are
 * harmless. Unknown events get 200 so the provider stops retrying.
 */
@ApiTags('Billing')
@Controller('billing/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly billing: BillingService) {}

  /** Omise sends charge.complete here (configure https://<api host>/api/v1/billing/webhooks/omise in the Omise dashboard). */
  @Post(':provider')
  @HttpCode(200)
  receive(@Param('provider') provider: string, @Body() event: Record<string, never>) {
    return this.billing.handleWebhook(provider, event);
  }
}

/** Picks the gateway from PAYMENT_PROVIDER: mock (default) or omise (OMISE_SECRET_KEY, OMISE_API_URL). */
export function createPaymentGateway(config: ConfigService): PaymentGateway {
  const provider = config.get<string>('PAYMENT_PROVIDER', 'mock');
  if (provider === 'mock') return new MockPaymentGateway(config.get<string>('APP_URL', 'http://localhost:5173'));
  if (provider === 'omise') {
    return new OmisePaymentGateway(config.getOrThrow<string>('OMISE_SECRET_KEY'), config.get<string>('OMISE_API_URL', 'https://api.omise.co'));
  }
  throw new Error(`PAYMENT_PROVIDER "${provider}" is not supported (use mock or omise)`);
}

@Module({
  controllers: [BillingController, MockGatewayController, PaymentWebhooksController],
  providers: [
    BillingService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: createPaymentGateway,
    },
  ],
})
export class BillingModule {}
