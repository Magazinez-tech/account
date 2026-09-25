import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantDb } from '../database/tenant-db.service';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  typ: 'access' | 'refresh';
}

export interface AuthUser {
  userId: string;
  tenantId: string;
  email: string;
  /** Loaded from the DB on each request, not from the token. */
  roles: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: TenantDb,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }
    // A refresh token must not work as an access token.
    if (payload.typ !== 'access') throw new UnauthorizedException();

    // Checked per request so deactivating a user or changing roles applies immediately,
    // not when the (24h) access token expires.
    const [row]: { is_active: boolean; roles: string[] }[] = await this.db.run(payload.tenantId, (m) =>
      m.query(
        `SELECT u.is_active, COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
          WHERE u.id = $1
          GROUP BY u.id`,
        [payload.sub],
      ),
    );
    if (!row?.is_active) throw new UnauthorizedException();

    req.user = { userId: payload.sub, tenantId: payload.tenantId, email: payload.email, roles: row.roles } satisfies AuthUser;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
