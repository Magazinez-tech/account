import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { AuthUser } from './jwt-auth.guard';

export const ROLE_NAMES = ['Admin', 'User'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

const ROLES_KEY = 'roles';

/** Restricts a handler (or controller) to users holding at least one of these roles. */
export const Roles = (...roles: RoleName[]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiForbiddenResponse({ description: `Requires role: ${roles.join(' or ')}` }),
  );

/**
 * Runs after JwtAuthGuard, which loads the user's current roles from the database on every
 * request, so revoking a role takes effect immediately instead of when the token expires.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;

    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user?.roles.some((r) => (required as string[]).includes(r))) {
      throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
    }
    return true;
  }
}
