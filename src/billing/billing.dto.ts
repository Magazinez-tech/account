import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckoutDto {
  /**
   * Plan code: starter, pro or business.
   * @example pro
   */
  @IsString()
  @MaxLength(50)
  planCode: string;
}

export class MockCompleteDto {
  /** Result the mock gateway reports for the charge. */
  @ApiProperty({ enum: ['succeeded', 'failed'], example: 'succeeded' })
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';

  /** @example Card declined */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  failureMessage?: string;
}

export class SimulatePaymentDto {
  /** Test mode only: the result to make the gateway report for the invoice's pending charge. */
  @ApiProperty({ enum: ['succeeded', 'failed'], example: 'succeeded' })
  @IsIn(['succeeded', 'failed'])
  outcome: 'succeeded' | 'failed';
}
