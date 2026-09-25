import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantDb } from '../database/tenant-db.service';

/**
 * Locks an account (tenant + email) after too many failed sign-ins: LOGIN_MAX_FAILURES failures
 * (default 5) within LOGIN_LOCKOUT_MINUTES (default 15) lock it for LOGIN_LOCKOUT_MINUTES.
 * Unknown emails are counted too, so the response never reveals whether an account exists.
 *
 * State lives in PostgreSQL (login_lockouts), so every API instance sees the same counters.
 * Per-IP limits are separate (ThrottlerGuard on the auth routes).
 */
@Injectable()
export class LoginLockoutService {
  private readonly maxFailures: number;
  private readonly lockoutMinutes: number;

  constructor(
    private readonly db: TenantDb,
    config: ConfigService,
  ) {
    this.maxFailures = Number(config.get('LOGIN_MAX_FAILURES', 5));
    this.lockoutMinutes = Number(config.get('LOGIN_LOCKOUT_MINUTES', 15));
  }

  static key(tenantId: string, email: string) {
    return `${tenantId}:${email.trim().toLowerCase()}`;
  }

  /** Throws 429 while the account is locked; call before checking the password. */
  async assertNotLocked(key: string, now = new Date()) {
    const [row]: { locked_until: Date | null }[] = await this.db.system.query(
      `SELECT locked_until FROM login_lockouts WHERE key = $1`,
      [key],
    );
    if (row?.locked_until && row.locked_until > now) {
      const retryAfter = Math.ceil((row.locked_until.getTime() - now.getTime()) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Too many failed login attempts',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Counts a failure in the current window; the failure that reaches the limit starts the lock. */
  async recordFailure(key: string) {
    const window = `${this.lockoutMinutes} minutes`;
    const [{ failures }]: { failures: number }[] = await this.db.system.query(
      `INSERT INTO login_lockouts (key, failures, window_start) VALUES ($1, 1, now())
       ON CONFLICT (key) DO UPDATE SET
         failures     = CASE WHEN login_lockouts.window_start < now() - $2::interval THEN 1 ELSE login_lockouts.failures + 1 END,
         window_start = CASE WHEN login_lockouts.window_start < now() - $2::interval THEN now() ELSE login_lockouts.window_start END
       RETURNING failures`,
      [key, window],
    );
    if (failures >= this.maxFailures) {
      await this.db.system.query(
        `UPDATE login_lockouts SET locked_until = now() + $2::interval, failures = 0, window_start = now() WHERE key = $1`,
        [key, window],
      );
    }
    return failures;
  }

  /** A successful sign-in clears the account's counter. */
  async recordSuccess(key: string) {
    await this.db.system.query(`DELETE FROM login_lockouts WHERE key = $1`, [key]);
  }
}
