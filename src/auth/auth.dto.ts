import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class LoginDto {
  /** @example admin@demo.com */
  @IsEmail()
  email: string;

  /** @example Admin1234 */
  @IsString()
  @MinLength(1)
  password: string;

  /** Tenant to sign in to. Give either tenantId or tenantSlug. */
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  /**
   * Tenant to sign in to, by the slug chosen at signup. Give either tenantId or tenantSlug.
   * @example demo
   */
  @IsOptional()
  @IsString()
  tenantSlug?: string;
}

export class RefreshDto {
  /** refreshToken from login, signup or a previous refresh. */
  @IsString()
  refreshToken: string;
}
