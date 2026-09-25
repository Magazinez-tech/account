import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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
