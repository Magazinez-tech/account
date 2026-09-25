import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BILLING_NOTE_STATUSES, QUOTATION_STATUSES } from '../database/entities';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Empty strings from forms mean "not set". */
const emptyToNull = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value));

export class CreateCustomerDto {
  /** @example บริษัท ลูกค้าดี จำกัด */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  /**
   * 13-digit tax ID (companies) or national ID (individuals).
   * @example 0105559999999
   */
  @IsOptional()
  @emptyToNull()
  @Matches(/^\d{13}$/, { message: 'taxId must be 13 digits' })
  taxId?: string | null;

  /**
   * Branch number, 00000 = head office. Leave out for customers that aren't VAT registered.
   * @example 00000
   */
  @IsOptional()
  @emptyToNull()
  @Matches(/^\d{5}$/, { message: 'branchCode must be 5 digits' })
  branchCode?: string | null;

  /** @example 99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110 */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  /** @example คุณสมศรี */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(200)
  contactName?: string | null;

  /** @example 02-123-4567 */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  /** @example ap@customer.co.th */
  @IsOptional()
  @emptyToNull()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  /**
   * Credit terms in days (0-365); a billing note's default due date is its date plus this.
   * @example 30
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  creditDays?: number;

  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** Only the fields sent are changed. */
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  /** false hides the customer from pickers; its documents stay. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CustomerListQuery {
  /** Include deactivated customers. */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: 'true' | 'false';
}

export class SalesLineDto {
  /** @example ออกแบบเว็บไซต์ */
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  description: string;

  /**
   * Up to 2 decimals.
   * @example 1
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999_999.99)
  quantity: number;

  /** @example งาน */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(30)
  unit?: string | null;

  /**
   * Price per unit before VAT, in baht.
   * @example 25000
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9_999_999_999.99)
  unitPrice: number;
}

export class SalesDocumentDto {
  @IsUUID()
  customerId: string;

  /**
   * Document date, YYYY-MM-DD.
   * @example 2026-09-25
   */
  @Matches(DATE_ONLY, { message: 'docDate must be YYYY-MM-DD' })
  docDate: string;

  /**
   * Quotation: valid until. Billing note: due date; defaults to the date plus the customer's credit days.
   * @example 2026-10-25
   */
  @IsOptional()
  @emptyToNull()
  @Matches(DATE_ONLY, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string | null;

  /** Customer's PO number or other reference. */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(100)
  reference?: string | null;

  /** Terms or remarks printed on the document. */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  /** Charge VAT at the system rate (7%). Default true. */
  @IsOptional()
  @IsBoolean()
  vat?: boolean;

  /**
   * Discount in baht, taken off the subtotal before VAT.
   * @example 0
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  /** 1-100 lines. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines: SalesLineDto[];
}

export class BillingNoteDto extends SalesDocumentDto {
  /** Billing note: revenue account credited on issue. Defaults to 4000 (รายได้จากการขาย). */
  @IsOptional()
  @emptyToNull()
  @IsUUID()
  revenueAccountId?: string | null;
}

export class QuotationListQuery {
  @ApiProperty({ enum: QUOTATION_STATUSES, required: false })
  @IsOptional()
  @IsIn(QUOTATION_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}

export class BillingNoteListQuery {
  @ApiProperty({ enum: BILLING_NOTE_STATUSES, required: false })
  @IsOptional()
  @IsIn(BILLING_NOTE_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;
}

const QUOTATION_TARGETS = ['draft', 'sent', 'accepted', 'rejected'] as const;

export class QuotationStatusDto {
  /** draft -> sent -> accepted or rejected; sent -> draft to revise. */
  @ApiProperty({ enum: QUOTATION_TARGETS })
  @IsIn(QUOTATION_TARGETS)
  status: (typeof QUOTATION_TARGETS)[number];
}

export class BillFromQuotationDto {
  /**
   * Billing note date; defaults to today.
   * @example 2026-09-30
   */
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'docDate must be YYYY-MM-DD' })
  docDate?: string;
}

export class ReceivePaymentDto {
  /**
   * Date the money was received, YYYY-MM-DD.
   * @example 2026-10-20
   */
  @Matches(DATE_ONLY, { message: 'paidDate must be YYYY-MM-DD' })
  paidDate: string;

  /** Cash or bank account (asset) that received the money. Defaults to 1010 (เงินฝากธนาคาร). */
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
