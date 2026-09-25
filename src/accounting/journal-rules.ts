import { BadRequestException } from '@nestjs/common';
import { fromSatang, toSatang } from '../common/money';

/**
 * Double-entry rules for a journal entry's lines: every line is one-sided (a debit or a credit,
 * never both or neither) and total debits equal total credits. Checked in satang so float
 * rounding can't make a balanced entry look unbalanced. Returns the lines numbered and in satang.
 */
export function toBalancedLines<T extends { debit?: number; credit?: number }>(input: T[]) {
  const lines = input.map((l, i) => ({ ...l, lineNo: i + 1, debit: toSatang(l.debit), credit: toSatang(l.credit) }));

  for (const l of lines) {
    if ((l.debit > 0) === (l.credit > 0)) {
      throw new BadRequestException(`Line ${l.lineNo}: enter either a debit or a credit amount, not both or neither`);
    }
  }
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebit !== totalCredit) {
    throw new BadRequestException(
      `Entry is not balanced: debit ${fromSatang(totalDebit).toFixed(2)} ≠ credit ${fromSatang(totalCredit).toFixed(2)}`,
    );
  }
  return lines;
}
