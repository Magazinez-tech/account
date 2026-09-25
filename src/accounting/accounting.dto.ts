import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ACCOUNT_TYPES, AccountType } from '../database/entities';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAccountDto {
  /**
   * Account code, unique within the tenant: 1-20 letters, digits, dots or dashes.
   * @example 1020
   */
  @Matches(/^[0-9A-Za-z.-]{1,20}$/, { message: 'code must be 1-20 letters, digits, dots or dashes' })
  code: string;

  /** @example เงินฝากออมทรัพย์ */
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ enum: ACCOUNT_TYPES, example: 'asset' })
  @IsIn(ACCOUNT_TYPES)
  type: AccountType;

  /** Optional parent account (must belong to the same tenant). */
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class JournalLineDto {
  /** Active account of the same tenant. */
  @IsUUID()
  accountId: string;

  /** @example ขายสินค้า */
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Debit amount in baht, up to 2 decimals. Give either debit or credit on a line.
   * @example 10700
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  /** Credit amount in baht, up to 2 decimals. Give either debit or credit on a line. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;
}

export class CreateJournalEntryDto {
  /**
   * Accounting date, YYYY-MM-DD.
   * @example 2026-09-05
   */
  @Matches(DATE_ONLY, { message: 'entryDate must be YYYY-MM-DD' })
  entryDate: string;

  /** @example Cash sale with VAT */
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * External document number, e.g. an invoice.
   * @example INV-0001
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  /** At least two lines; total debits must equal total credits. */
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

export class DateRangeQuery {
  /**
   * First day included, YYYY-MM-DD.
   * @example 2026-01-01
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /**
   * Last day included, YYYY-MM-DD.
   * @example 2026-12-31
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class AsOfQuery {
  /**
   * Include entries dated on or before this day, YYYY-MM-DD. Omit for all posted entries.
   * @example 2026-09-30
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;
}
