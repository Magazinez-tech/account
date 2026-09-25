import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ALLOW_READ_ONLY_KEY, subscriptionAccess } from '../billing/subscription-access';
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

interface UserState {
  is_active: boolean;
  roles: string[];
  sub_status: string | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  canceled_at: Date | null;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: TenantDb,
    private readonly reflector: Reflector,
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

    // Checked per request so deactivating a user, changing roles, or a subscription lapsing applies
    // immediately, not when the (24h) access token expires. One query covers all three.
    const [row]: UserState[] = await this.db.run(payload.tenantId, (m) =>
      m.query(
        `SELECT u.is_active,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
                s.status AS sub_status, s.trial_ends_at, s.current_period_end, s.canceled_at
           FROM users u
           LEFT JOIN user_roles ur ON ur.user_id = u.id
           LEFT JOIN roles r ON r.id = ur.role_id
           LEFT JOIN LATERAL (
                  SELECT status, trial_ends_at, current_period_end, canceled_at
                    FROM subscriptions ORDER BY created_at DESC LIMIT 1) s ON true
          WHERE u.id = $1
          GROUP BY u.id, s.status, s.trial_ends_at, s.current_period_end, s.canceled_at`,
        [payload.sub],
      ),
    );
    if (!row?.is_active) throw new UnauthorizedException();

    // Trial over or unpaid: reads still work, writes are refused except where explicitly allowed (billing).
    if (!SAFE_METHODS.has(req.method)) {
      const access = subscriptionAccess(
        row.sub_status === null
          ? null
          : { status: row.sub_status, trialEndsAt: row.trial_ends_at, currentPeriodEnd: row.current_period_end, canceledAt: row.canceled_at },
      );
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_READ_ONLY_KEY, [ctx.getHandler(), ctx.getClass()]);
      if (access.readOnly && !allowed) {
        throw new HttpException(
          { statusCode: HttpStatus.PAYMENT_REQUIRED, error: 'Payment Required', message: 'Subscription inactive' },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    }

    req.user = { userId: payload.sub, tenantId: payload.tenantId, email: payload.email, roles: row.roles } satisfies AuthUser;
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
