import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ROLE_NAMES, RoleName } from '../auth/roles.guard';

export class InviteUserDto {
  /** @example clerk@demo.com */
  @IsEmail()
  email: string;

  /** @example สมหญิง ใจดี */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  /** Role the user gets on accepting: Admin (full access) or User (read everything, post entries). */
  @ApiProperty({ enum: ROLE_NAMES, example: 'User' })
  @IsIn(ROLE_NAMES)
  role: RoleName;
}

export class UpdateUserDto {
  /** Replaces the user's roles with this single role. */
  @ApiProperty({ enum: ROLE_NAMES, required: false })
  @IsOptional()
  @IsIn(ROLE_NAMES)
  role?: RoleName;

  /** false deactivates the user (signed out on their next request); true reactivates. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AcceptInvitationDto {
  /** Password for the new account, 8-72 characters. */
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores bytes beyond 72
  password: string;
}
