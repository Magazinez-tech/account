import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName, RolesGuard } from './roles.guard';

function context(user: { roles: string[] } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: RoleName[] | undefined) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('lets everyone through when no role is required', () => {
    expect(guardRequiring(undefined).canActivate(context({ roles: [] }))).toBe(true);
    expect(guardRequiring([]).canActivate(context({ roles: [] }))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    expect(guardRequiring(['Admin']).canActivate(context({ roles: ['Admin'] }))).toBe(true);
    expect(guardRequiring(['Admin', 'User']).canActivate(context({ roles: ['User'] }))).toBe(true);
  });

  it('refuses a user without the role, naming the requirement', () => {
    expect(() => guardRequiring(['Admin']).canActivate(context({ roles: ['User'] }))).toThrow(
      new ForbiddenException('Requires role: Admin'),
    );
  });

  it('refuses when no user was attached (JwtAuthGuard did not run)', () => {
    expect(() => guardRequiring(['Admin']).canActivate(context(undefined))).toThrow(ForbiddenException);
  });
});
