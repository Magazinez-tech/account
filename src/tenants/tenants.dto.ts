import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase letters, digits and dashes' })
  @MaxLength(100)
  slug: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  companyName: string;

  @IsOptional()
  @Matches(/^\d{10,13}$/, { message: 'companyTaxId must be 10-13 digits' })
  companyTaxId?: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  adminFullName: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores bytes beyond 72
  adminPassword: string;
}
