import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatAmount, formatMoney, fromSatang, parseSatang, startOfFiscalYear, startOfMonth, today } from './format';

describe('parseSatang', () => {
  it.each([
    ['10700', 1070000],
    ['10,700', 1070000],
    ['1,234.5', 123450],
    ['0.05', 5],
    ['12.', 1200],
    ['  99.99 ', 9999],
    ['', 0],
  ])('parses %j as %i satang', (input, satang) => {
    expect(parseSatang(input)).toBe(satang);
  });

  it.each(['abc', '1.234', '-5', '1e3', '1.2.3', '.5'])('rejects %j', (input) => {
    expect(parseSatang(input)).toBeNull();
  });

  it('avoids float error: 0.1 + 0.2 in satang is exact', () => {
    expect(parseSatang('0.1')! + parseSatang('0.2')!).toBe(parseSatang('0.3'));
  });
});

describe('money formatting', () => {
  it('always shows two decimals with thousands separators', () => {
    expect(formatMoney(10700)).toBe('10,700.00');
    expect(formatMoney('845.3')).toBe('845.30');
    expect(formatMoney(fromSatang(5))).toBe('0.05');
  });

  it('shows negatives in parentheses, accounting style', () => {
    expect(formatAmount(-5000)).toBe('(5,000.00)');
    expect(formatAmount(5000)).toBe('5,000.00');
    expect(formatAmount(0)).toBe('0.00');
  });
});

describe('dates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the local calendar date, not UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 23, 30)); // 25 Sep, late evening local time
    expect(today()).toBe('2026-09-25');
    expect(startOfMonth()).toBe('2026-09-01');
  });

  it('finds the start of the fiscal year containing today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25)); // September 2026
    expect(startOfFiscalYear(1)).toBe('2026-01-01');
    expect(startOfFiscalYear(9)).toBe('2026-09-01'); // starts this month
    expect(startOfFiscalYear(10)).toBe('2025-10-01'); // Thai government-style Oct-Sep year
  });
});
