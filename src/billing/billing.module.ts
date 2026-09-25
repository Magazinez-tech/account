import { Body, Controller, Get, HttpCode, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated } from '../auth/authenticated.decorator';
import { AuthUser, CurrentUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.guard';
import { CheckoutDto, MockCompleteDto } from './billing.dto';
import { BillingService } from './billing.service';
import { MockPaymentGateway, PAYMENT_GATEWAY } from './payment-gateway';

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
   * Redirect the admin to `redirectUrl`; the gateway sends them back to `APP_URL/billing?invoice=<id>`.
   * Voids any earlier unpaid invoice.
   */
  @Post('checkout')
  @Roles('Admin')
  @ApiBadRequestResponse({ description: 'Unknown plan' })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.billing.checkout(user, dto.planCode);
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

@Module({
  controllers: [BillingController, MockGatewayController],
  providers: [
    BillingService,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('PAYMENT_PROVIDER', 'mock');
        // Omise / Stripe gateways implement the same PaymentGateway interface and plug in here.
        if (provider !== 'mock') throw new Error(`PAYMENT_PROVIDER "${provider}" is not implemented yet`);
        return new MockPaymentGateway(config.get<string>('APP_URL', 'http://localhost:5173'));
      },
    },
  ],
})
export class BillingModule {}
