import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Allowed browser origins. Production allows only CORS_ORIGINS (comma-separated) or, failing
 * that, APP_URL. Development reflects any origin so local tools work.
 */
export function corsOptions(env: NodeJS.ProcessEnv): CorsOptions {
  if (env.NODE_ENV !== 'production') return { origin: true };
  const origins = (env.CORS_ORIGINS ?? env.APP_URL ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (origins.length === 0) throw new Error('Set APP_URL or CORS_ORIGINS in production so CORS can be restricted');
  return { origin: origins };
}

/**
 * Express "trust proxy" from TRUST_PROXY: unset -> off (req.ip is the socket address), "true" ->
 * trust all, a number -> that many hops, anything else -> addresses/subnets (e.g. "loopback, 10.0.0.0/8").
 * Needed behind a load balancer so rate limits see the client IP, not the proxy's.
 */
export function trustProxy(env: NodeJS.ProcessEnv): boolean | number | string {
  const value = env.TRUST_PROXY?.trim();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
