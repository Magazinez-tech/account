import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenantDb } from '../database/tenant-db.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const PAYLOAD = { sub: 'user-1', tenantId: 'tenant-1', email: 'a@b.com', typ: 'access' };

function userRow(overrides: Record<string, unknown> = {}) {
  return { is_active: true, roles: ['Admin'], ...overrides };
}

function setup({ payload = PAYLOAD as object | Error, rows = [userRow()] as object[] } = {}) {
  const jwt = {
    verifyAsync: jest.fn(() => (payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload))),
  } as unknown as JwtService;
  const query = jest.fn().mockResolvedValue(rows);
  const db = { run: jest.fn((_tenantId: string, work: (m: unknown) => unknown) => work({ query })) } as unknown as TenantDb;
  const reflector = {} as unknown as Reflector;
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
    const status = async (p: Promise<unknown>) => {
      try { await p; return 'ok'; } catch (err: unknown) { return (err as { getStatus(): number }).getStatus(); }
    };
    expect(await status(setup({ rows: [userRow({ is_active: false })] }).guard.canActivate(request().ctx))).toBe(401);
    expect(await status(setup({ rows: [] }).guard.canActivate(request().ctx))).toBe(401);
  });
});
