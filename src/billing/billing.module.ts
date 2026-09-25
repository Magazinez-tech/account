import { Body, Controller, Get, HttpCode, Module, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { BillingService } from './billing.service';
import { MockPaymentGateway, PAYMENT_GATEWAY } from './payment-gateway';
import { AllowWhenReadOnly } from './subscription-access';

class CheckoutDto {
  @IsString()
  @MaxLength(50)
  planCode: string;
}

class MockCompleteDto {
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  failureMessage?: string;
}

@Controller('billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@AllowWhenReadOnly() // a locked-out tenant must still be able to pay
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Any member: subscription state for the header banner. */
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.billing.status(user);
  }

  @Get()
  @Roles('Admin')
  overview(@CurrentUser() user: AuthUser) {
    return this.billing.overview(user);
  }

  @Post('checkout')
  @Roles('Admin')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto) {
    return this.billing.checkout(user, dto.planCode);
  }

  @Post('cancel')
  @HttpCode(200)
  @Roles('Admin')
  cancel(@CurrentUser() user: AuthUser) {
    return this.billing.cancel(user);
  }

  @Post('resume')
  @HttpCode(200)
  @Roles('Admin')
  resume(@CurrentUser() user: AuthUser) {
    return this.billing.resume(user);
  }
}

/**
 * Stands in for the payment provider's hosted page and webhook. Public, like a real webhook;
 * the unguessable charge id is the only handle. Returns 404 unless PAYMENT_PROVIDER=mock.
 */
@Controller('billing/mock/charges')
export class MockGatewayController {
  constructor(
    private readonly billing: BillingService,
    private readonly config: ConfigService,
  ) {}

  private assertMock() {
    if (this.config.get('PAYMENT_PROVIDER', 'mock') !== 'mock') throw new NotFoundException();
  }

  @Get(':chargeId')
  details(@Param('chargeId') chargeId: string) {
    this.assertMock();
    return this.billing.chargeDetails(chargeId);
  }

  @Post(':chargeId/complete')
  @HttpCode(200)
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
