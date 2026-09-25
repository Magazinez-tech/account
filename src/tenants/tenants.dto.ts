import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Empty strings from forms mean "not set". */
const emptyToNull = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value));

export class CreateTenantDto {
  /**
   * Organization name shown in the app.
   * @example My Company
   */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  /**
   * Unique sign-in handle: lowercase letters, digits and single dashes.
   * @example my-company
   */
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase letters, digits and dashes' })
  @MaxLength(100)
  slug: string;

  /**
   * Legal company name.
   * @example บริษัท มายคอมพานี จำกัด
   */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName: string;

  /**
   * Thai tax ID, 10-13 digits.
   * @example 0105561234567
   */
  @IsOptional()
  @Matches(/^\d{10,13}$/, { message: 'companyTaxId must be 10-13 digits' })
  companyTaxId?: string;

  /** @example owner@mycompany.com */
  @IsEmail()
  adminEmail: string;

  /** @example สมชาย ใจดี */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  adminFullName: string;

  /** 8-72 characters. */
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores bytes beyond 72
  adminPassword: string;
}

/** Company profile printed on quotations and billing notes. Only the fields sent are changed. */
export class UpdateCompanyDto {
  /**
   * Legal company name.
   * @example บริษัท มายคอมพานี จำกัด
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  /**
   * 13-digit tax ID.
   * @example 0105561234567
   */
  @IsOptional()
  @emptyToNull()
  @Matches(/^\d{10,13}$/, { message: 'taxId must be 10-13 digits' })
  taxId?: string | null;

  /**
   * Branch number: 00000 = head office (สำนักงานใหญ่).
   * @example 00000
   */
  @IsOptional()
  @Matches(/^\d{5}$/, { message: 'branchCode must be 5 digits' })
  branchCode?: string;

  /** @example 123 ถนนพระราม 4 แขวงสีลม เขตบางรัก กรุงเทพฯ 10500 */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(1000)
  address?: string | null;

  /** @example 02-000-0000 */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  /** @example accounts@mycompany.com */
  @IsOptional()
  @emptyToNull()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  /** @example https://mycompany.com */
  @IsOptional()
  @emptyToNull()
  @IsString()
  @MaxLength(200)
  website?: string | null;
}
