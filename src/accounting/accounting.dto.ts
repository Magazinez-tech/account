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
  @Matches(/^[0-9A-Za-z.-]{1,20}$/, { message: 'code must be 1-20 letters, digits, dots or dashes' })
  code: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsIn(ACCOUNT_TYPES)
  type: AccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class JournalLineDto {
  @IsUUID()
  accountId: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit?: number;
}

export class CreateJournalEntryDto {
  @Matches(DATE_ONLY, { message: 'entryDate must be YYYY-MM-DD' })
  entryDate: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

export class DateRangeQuery {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class AsOfQuery {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'asOf must be YYYY-MM-DD' })
  asOf?: string;
}
