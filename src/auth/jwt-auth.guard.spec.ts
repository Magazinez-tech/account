import { ExecutionContext, HttpException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantDb } from '../database/tenant-db.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const DAY = 24 * 60 * 60 * 1000;
const PAYLOAD = { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', typ: 'access' };

/** Row shape returned by the guard's user/roles/subscription query. */
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    is_active: true,
    roles: ['Admin'],
    sub_status: 'trialing',
    trial_ends_at: new Date(Date.now() + 7 * DAY),
    current_period_end: null,
    canceled_at: null,
    ...overrides,
  };
}

function setup({ payload = PAYLOAD as object | Error, rows = [userRow()] as object[], allowReadOnly = false } = {}) {
  const jwt = {
    verifyAsync: jest.fn(() => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))),
  } as unknown as JwtService;
  const query = jest.fn().mockResolvedValue(rows);
  const db = { run: jest.fn((_tenantId: string, work: (m: unknown) => unknown) => work({ query })) } as unknown as TenantDb;
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(allowReadOnly) } as unknown as Reflector;
  return { guard: new JwtAuthGuard(jwt, db, reflector), db };
}

function request(method = 'GET', authorization: string | null = 'Bearer token') {
  const req: Record<string, unknown> = { method, headers: authorization === null ? {} : { authorization } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { req, ctx };
}

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (err) {
    return (err as HttpException).getStatus();
  }
}

describe('JwtAuthGuard', () => {
  it('attaches the user with roles loaded from the database', async () => {
    const { guard, db } = setup({ rows: [userRow({ roles: ['User'] })] });
    const { req, ctx } = request();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ userId: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', roles: ['User'] });
    expect(db.run).toHaveBeenCalledWith('tenant-1', expect.any(Function));
  });

  it.each([
    ['no header', null],
    ['wrong scheme', 'Basic abc'],
    ['empty token', 'Bearer '],
  ])('rejects a request with %s', async (_label, authorization) => {
    const { guard } = setup();
    await expect(guard.canActivate(request('GET', authorization).ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an invalid or expired token', async () => {
    const { guard } = setup({ payload: new Error('jwt expired') });
    await expect(guard.canActivate(request().ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a refresh token used as an access token', async () => {
    const { guard } = setup({ payload: { ...PAYLOAD, typ: 'refresh' } });
    await expect(guard.canActivate(request().ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a deactivated or deleted user even with a valid token', async () => {
    expect(await statusOf(setup({ rows: [userRow({ is_active: false })] }).guard.canActivate(request().ctx))).toBe(401);
    expect(await statusOf(setup({ rows: [] }).guard.canActivate(request().ctx))).toBe(401);
  });

  describe('read-only subscriptions', () => {
    const expired = [userRow({ trial_ends_at: new Date(Date.now() - DAY) })];

    it('still allows reads', async () => {
      expect(await statusOf(setup({ rows: expired }).guard.canActivate(request('GET').ctx))).toBe('ok');
    });

    it.each(['POST', 'PATCH', 'DELETE'])('refuses %s with 402', async (method) => {
      const { guard } = setup({ rows: expired });
      const err = await guard.canActivate(request(method).ctx).catch((e: HttpException) => e);
      expect((err as HttpException).getStatus()).toBe(402);
      expect((err as HttpException).getResponse()).toMatchObject({ message: 'Subscription inactive' });
    });

    it('allows writes on handlers marked @AllowWhenReadOnly (billing)', async () => {
      expect(await statusOf(setup({ rows: expired, allowReadOnly: true }).guard.canActivate(request('POST').ctx))).toBe('ok');
    });

    it('treats a lapsed paid period as read-only and a current one as writable', async () => {
      const lapsed = [userRow({ sub_status: 'active', current_period_end: new Date(Date.now() - DAY) })];
      const current = [userRow({ sub_status: 'active', current_period_end: new Date(Date.now() + DAY) })];
      expect(await statusOf(setup({ rows: lapsed }).guard.canActivate(request('POST').ctx))).toBe(402);
      expect(await statusOf(setup({ rows: current }).guard.canActivate(request('POST').ctx))).toBe('ok');
    });

    it('treats a tenant with no subscription as read-only', async () => {
      const none = [userRow({ sub_status: null, trial_ends_at: null })];
      expect(await statusOf(setup({ rows: none }).guard.canActivate(request('POST').ctx))).toBe(402);
    });
  });
});
