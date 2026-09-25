import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ROLE_NAMES, RoleName } from '../auth/roles.guard';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  @IsIn(ROLE_NAMES)
  role: RoleName;
}

export class UpdateUserDto {
  /** Replaces the user's roles with this single role. */
  @IsOptional()
  @IsIn(ROLE_NAMES)
  role?: RoleName;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt ignores bytes beyond 72
  password: string;
}
