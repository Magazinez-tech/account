import { swaggerEnabled } from './swagger';

describe('swaggerEnabled', () => {
  it('is on in development and when NODE_ENV is unset', () => {
    expect(swaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(swaggerEnabled({})).toBe(true);
  });

  it('is off in production by default', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('follows SWAGGER_ENABLED when set', () => {
    expect(swaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })).toBe(true);
    expect(swaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' })).toBe(false);
  });
});
