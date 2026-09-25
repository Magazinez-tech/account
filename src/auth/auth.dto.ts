import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;

  /** Either tenantId or tenantSlug identifies which tenant to sign in to. */
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @IsOptional()
  @IsString()
  tenantSlug?: string;
}

export class RefreshDto {
  @IsString()
  refreshToken: string;
}
