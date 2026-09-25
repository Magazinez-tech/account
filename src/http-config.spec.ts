import { corsOptions, trustProxy } from './http-config';

describe('corsOptions', () => {
  it('reflects any origin outside production', () => {
    expect(corsOptions({})).toEqual({ origin: true });
  });

  it('allows only APP_URL in production', () => {
    expect(corsOptions({ NODE_ENV: 'production', APP_URL: 'https://app.example.com/' })).toEqual({ origin: ['https://app.example.com'] });
  });

  it('prefers an explicit CORS_ORIGINS list', () => {
    expect(
      corsOptions({ NODE_ENV: 'production', APP_URL: 'https://a.example.com', CORS_ORIGINS: 'https://a.example.com, https://admin.example.com' }),
    ).toEqual({ origin: ['https://a.example.com', 'https://admin.example.com'] });
  });

  it('fails fast in production without any origin configured', () => {
    expect(() => corsOptions({ NODE_ENV: 'production' })).toThrow(/APP_URL or CORS_ORIGINS/);
  });
});

describe('trustProxy', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['true', true],
    ['1', 1],
    ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
  ])('TRUST_PROXY=%j -> %j', (value, expected) => {
    expect(trustProxy({ TRUST_PROXY: value })).toEqual(expected);
  });
});
