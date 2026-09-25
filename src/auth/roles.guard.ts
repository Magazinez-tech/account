import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantDb } from '../database/tenant-db.service';
import { AuthUser } from './jwt-auth.guard';

export type RoleName = 'Admin' | 'User';

const ROLES_KEY = 'roles';

/** Restricts a handler (or controller) to users holding at least one of these roles. */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Runs after JwtAuthGuard. Roles are read from the database on every guarded request rather than
 * embedded in the JWT, so revoking a role takes effect immediately instead of when the token expires.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDb,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RoleName[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;

    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException();

    const rows: { name: string }[] = await this.db.run(user.tenantId, (m) =>
      m.query(
        `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND r.name = ANY($2)`,
        [user.userId, required],
      ),
    );
    if (rows.length === 0) throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
    return true;
  }
}
