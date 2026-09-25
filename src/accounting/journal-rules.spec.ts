import { BadRequestException } from '@nestjs/common';
import { toBalancedLines } from './journal-rules';

describe('toBalancedLines', () => {
  it('numbers lines and converts amounts to satang', () => {
    const lines = toBalancedLines([
      { accountId: 'cash', debit: 10700 },
      { accountId: 'sales', credit: 10000 },
      { accountId: 'vat', credit: 700 },
    ]);
    expect(lines).toEqual([
      { accountId: 'cash', lineNo: 1, debit: 1070000, credit: 0 },
      { accountId: 'sales', lineNo: 2, debit: 0, credit: 1000000 },
      { accountId: 'vat', lineNo: 3, debit: 0, credit: 70000 },
    ]);
  });

  it('accepts amounts whose float sum is not exact', () => {
    // 0.1 + 0.2 !== 0.3 in floating point, but 10 + 20 === 30 satang
    expect(() => toBalancedLines([{ debit: 0.1 }, { debit: 0.2 }, { credit: 0.3 }])).not.toThrow();
  });

  it('rejects an unbalanced entry with both totals in the message', () => {
    expect(() => toBalancedLines([{ debit: 100 }, { credit: 90 }])).toThrow(
      new BadRequestException('Entry is not balanced: debit 100.00 ≠ credit 90.00'),
    );
  });

  it('rejects a line with both a debit and a credit', () => {
    expect(() => toBalancedLines([{ debit: 100, credit: 100 }, { credit: 0 }])).toThrow(/Line 1: enter either a debit or a credit/);
  });

  it('rejects a line with neither (zero counts as empty)', () => {
    expect(() => toBalancedLines([{ debit: 50 }, { credit: 50 }, { debit: 0 }])).toThrow(/Line 3/);
  });
});
