import { fromSatang, toSatang } from './money';

describe('money', () => {
  it('converts baht to integer satang', () => {
    expect(toSatang(10700)).toBe(1070000);
    expect(toSatang('10700.50')).toBe(1070050);
    expect(toSatang(0.1)).toBe(10);
  });

  it('rounds away float noise instead of truncating', () => {
    // 19.99 * 100 is 1998.9999999999998 in floating point; truncating would lose a satang
    expect(toSatang(19.99)).toBe(1999);
    expect(toSatang(0.1 + 0.2)).toBe(30);
  });

  it('treats missing amounts as zero', () => {
    expect(toSatang(undefined)).toBe(0);
    expect(toSatang(null)).toBe(0);
  });

  it('round-trips through satang', () => {
    for (const baht of [0, 0.01, 1, 99.99, 845.3, 123456.78]) {
      expect(fromSatang(toSatang(baht))).toBe(baht);
    }
  });
});
