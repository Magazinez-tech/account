import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { TenantDb } from '../database/tenant-db.service';
import { AuthController } from './auth.module';
import { AuthService } from './auth.service';
import { RATE_LIMITS, scaledLimit } from './rate-limit.decorator';

/** Boots the real AuthController (with its guards) over HTTP; the service and DB are stubs. */
describe('per-IP rate limits (HTTP)', () => {
  let app: INestApplication;
  const auth = { login: jest.fn().mockResolvedValue({ accessToken: 'a' }), refresh: jest.fn().mockResolvedValue({ accessToken: 'b' }) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }], errorMessage: 'Too many requests' })],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        // Needed by JwtAuthGuard on GET /auth/me; not exercised here.
        { provide: JwtService, useValue: {} },
        { provide: TenantDb, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it(`allows ${RATE_LIMITS.login.limit} logins per minute per IP, then answers 429 with Retry-After`, async () => {
    const { limit } = RATE_LIMITS.login;
    for (let i = 0; i < limit; i++) {
      await request(app.getHttpServer()).post('/auth/login').send({}).expect(200);
    }
    const blocked = await request(app.getHttpServer()).post('/auth/login').send({}).expect(429);
    expect(blocked.body.message).toBe('Too many requests');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(auth.login).toHaveBeenCalledTimes(limit);
  });

  it('counts each route separately', async () => {
    await request(app.getHttpServer()).post('/auth/refresh').send({}).expect(200);
  });
});

describe('scaledLimit', () => {
  it('uses the base limit by default', () => {
    expect(scaledLimit(30, {})).toBe(30);
  });

  it('multiplies by RATE_LIMIT_SCALE', () => {
    expect(scaledLimit(30, { RATE_LIMIT_SCALE: '10' })).toBe(300);
    expect(scaledLimit(10, { RATE_LIMIT_SCALE: '0.5' })).toBe(5);
  });

  it('ignores invalid scales and never drops below 1', () => {
    expect(scaledLimit(30, { RATE_LIMIT_SCALE: 'abc' })).toBe(30);
    expect(scaledLimit(30, { RATE_LIMIT_SCALE: '-2' })).toBe(30);
    expect(scaledLimit(1, { RATE_LIMIT_SCALE: '0.01' })).toBe(1);
  });
});
