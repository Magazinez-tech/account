import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

const MINUTE = 60_000;

/**
 * Per-IP limits for the public endpoints (no token to identify the caller). Counters are per route
 * and per API instance (in memory); behind a load balancer set TRUST_PROXY so the client IP is used.
 * Account-level brute force is handled separately by LoginLockoutService.
 */
export const RATE_LIMITS = {
  login: { limit: 30, ttl: MINUTE },
  refresh: { limit: 60, ttl: MINUTE },
  signup: { limit: 10, ttl: 10 * MINUTE },
  /** Tenant slug lookup and invite links: slows down enumeration. */
  publicLookup: { limit: 60, ttl: MINUTE },
} as const;

/**
 * RATE_LIMIT_SCALE multiplies every limit (default 1 = the values above). Raise it for local
 * development, where test suites run back to back from one IP; leave it unset in production.
 * Read per request so it follows .env without a rebuild.
 */
export function scaledLimit(base: number, env: NodeJS.ProcessEnv = process.env): number {
  const scale = Number(env.RATE_LIMIT_SCALE ?? 1);
  return Math.max(1, Math.round(base * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
}

export function RateLimit(name: keyof typeof RATE_LIMITS) {
  const { limit, ttl } = RATE_LIMITS[name];
  return applyDecorators(
    UseGuards(ThrottlerGuard),
    Throttle({ default: { limit: () => scaledLimit(limit), ttl } }),
    ApiTooManyRequestsResponse({ description: `More than ${limit} requests in ${ttl / MINUTE} min from one IP` }),
  );
}
