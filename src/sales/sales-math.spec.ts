import { BadRequestException } from '@nestjs/common';
import { addDays, assertQuotationTransition, documentTotals, formatDocNo, lineAmount, MAX_TOTAL_SATANG } from './sales-math';

describe('lineAmount', () => {
  it('multiplies quantity by price in satang', () => {
    expect(lineAmount(3, 150_00)).toBe(450_00);
    expect(lineAmount(1.5, 199_99)).toBe(299_99); // 299.985 rounds half up
  });

  it('handles quantities that are not exact in binary floating point', () => {
    expect(lineAmount(1.15, 100_00)).toBe(115_00);
    expect(lineAmount(0.1, 3)).toBe(0); // 0.3 satang
  });

  it('refuses amounts too large to sum exactly', () => {
    expect(() => lineAmount(999_999.99, 99_999_999_99)).toThrow(BadRequestException);
    expect(lineAmount(1, MAX_TOTAL_SATANG)).toBe(MAX_TOTAL_SATANG);
  });
});

describe('documentTotals', () => {
  const lines = [
    { quantity: 2, unitPrice: 1500 },
    { quantity: 1, unitPrice: 999.5 },
  ];

  it('sums lines, takes the discount off before VAT', () => {
    expect(documentTotals(lines, 0, 7)).toEqual({
      amounts: [3000_00, 999_50],
      subtotal: 3999_50,
      discount: 0,
      net: 3999_50,
      vat: 279_97, // 279.965 rounds up
      total: 4279_47,
    });
    const discounted = documentTotals(lines, 999.5, 7);
    expect(discounted).toMatchObject({ net: 3000_00, vat: 210_00, total: 3210_00, discount: 999_50 });
  });

  it('supports documents without VAT', () => {
    expect(documentTotals(lines, 0, 0)).toMatchObject({ vat: 0, total: 3999_50 });
  });

  it('rejects a discount larger than the subtotal', () => {
    expect(() => documentTotals(lines, 4000, 7)).toThrow('Discount exceeds the subtotal');
  });

  it('rejects totals over the maximum, including VAT', () => {
    expect(() => documentTotals([{ quantity: 1, unitPrice: 9_500_000_000 }], 0, 7)).toThrow('Document total is too large');
  });
});

describe('document numbers and dates', () => {
  it('formats per type and year of the document date', () => {
    expect(formatDocNo('quotation', '2026-09-25', 1)).toBe('QT-2026-0001');
    expect(formatDocNo('billing_note', '2027-01-02', 12345)).toBe('BN-2027-12345');
  });

  it('adds calendar days across month and year ends', () => {
    expect(addDays('2026-09-25', 30)).toBe('2026-10-25');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-09-25', 0)).toBe('2026-09-25');
  });
});

describe('quotation status transitions', () => {
  it('allows draft -> sent -> accepted/rejected, and sent back to draft', () => {
    expect(() => assertQuotationTransition('draft', 'sent')).not.toThrow();
    expect(() => assertQuotationTransition('sent', 'accepted')).not.toThrow();
    expect(() => assertQuotationTransition('sent', 'rejected')).not.toThrow();
    expect(() => assertQuotationTransition('sent', 'draft')).not.toThrow();
  });

  it('refuses skipping or leaving a final state', () => {
    expect(() => assertQuotationTransition('draft', 'accepted')).toThrow('Cannot change a draft quotation to accepted');
    expect(() => assertQuotationTransition('accepted', 'sent')).toThrow(BadRequestException);
    expect(() => assertQuotationTransition('rejected', 'accepted')).toThrow(BadRequestException);
    expect(() => assertQuotationTransition('void', 'draft')).toThrow(BadRequestException);
  });
});
