import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantDb } from '../database/tenant-db.service';
import { LoginLockoutService } from './login-lockout.service';

function setup(config: Record<string, unknown> = {}) {
  const query = jest.fn();
  const db = { system: { query } } as unknown as TenantDb;
  const cfg = { get: (key: string, fallback: unknown) => config[key] ?? fallback } as unknown as ConfigService;
  return { service: new LoginLockoutService(db, cfg), query };
}

describe('LoginLockoutService', () => {
  it('keys by tenant and normalized email', () => {
    expect(LoginLockoutService.key('t1', '  Admin@Example.COM ')).toBe('t1:admin@example.com');
  });

  describe('assertNotLocked', () => {
    const now = new Date('2026-09-25T12:00:00Z');

    it('passes when there is no record or the lock has expired', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([]);
      await expect(service.assertNotLocked('k', now)).resolves.toBeUndefined();
      query.mockResolvedValueOnce([{ locked_until: new Date('2026-09-25T11:59:59Z') }]);
      await expect(service.assertNotLocked('k', now)).resolves.toBeUndefined();
    });

    it('throws 429 with seconds until unlock while locked', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([{ locked_until: new Date('2026-09-25T12:10:00.500Z') }]);
      const err = (await service.assertNotLocked('k', now).catch((e) => e)) as HttpException;
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ message: 'Too many failed login attempts', retryAfter: 601 });
    });
  });

  describe('recordFailure', () => {
    it('counts failures without locking below the limit', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([{ failures: 4 }]);
      await expect(service.recordFailure('k')).resolves.toBe(4);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][1]).toEqual(['k', '15 minutes']);
    });

    it('locks the account when a failure reaches the limit', async () => {
      const { service, query } = setup();
      query.mockResolvedValueOnce([{ failures: 5 }]).mockResolvedValueOnce([]);
      await service.recordFailure('k');
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1][0]).toMatch(/SET locked_until = now\(\) \+ \$2::interval/);
      expect(query.mock.calls[1][1]).toEqual(['k', '15 minutes']);
    });

    it('honours LOGIN_MAX_FAILURES and LOGIN_LOCKOUT_MINUTES', async () => {
      const { service, query } = setup({ LOGIN_MAX_FAILURES: '3', LOGIN_LOCKOUT_MINUTES: '30' });
      query.mockResolvedValueOnce([{ failures: 3 }]).mockResolvedValueOnce([]);
      await service.recordFailure('k');
      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1][1]).toEqual(['k', '30 minutes']);
    });
  });

  it('clears the counter on success', async () => {
    const { service, query } = setup();
    query.mockResolvedValueOnce([]);
    await service.recordSuccess('k');
    expect(query).toHaveBeenCalledWith('DELETE FROM login_lockouts WHERE key = $1', ['k']);
  });
});
