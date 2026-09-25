import { BadRequestException } from '@nestjs/common';
import { priceWithVat } from '../billing/billing-math';
import { toSatang } from '../common/money';
import { QuotationStatus, SalesDocType } from '../database/entities';

/** Largest document total accepted, in satang (9,999,999,999.99 baht): keeps every sum exact in a JS number. */
export const MAX_TOTAL_SATANG = 999_999_999_999;

/** Quantity (2 decimals) × unit price (satang), rounded half up to the satang. Exact for any size. */
export function lineAmount(quantity: number, unitPriceSatang: number): number {
  const hundredths = BigInt(Math.round(quantity * 100));
  const amount = (hundredths * BigInt(unitPriceSatang) + 50n) / 100n;
  if (amount > BigInt(MAX_TOTAL_SATANG)) throw new BadRequestException('Document total is too large');
  return Number(amount);
}

/**
 * Totals of a quotation or billing note, all in satang. Prices exclude VAT; the discount comes off
 * the subtotal before VAT, and VAT rounds half up on the discounted amount.
 */
export function documentTotals(lines: { quantity: number; unitPrice: number }[], discount: number, vatRate: number) {
  const amounts = lines.map((l) => lineAmount(l.quantity, toSatang(l.unitPrice)));
  const subtotal = amounts.reduce((s, a) => s + a, 0);
  const discountSatang = toSatang(discount);
  if (discountSatang > subtotal) throw new BadRequestException('Discount exceeds the subtotal');
  const { vat, total } = priceWithVat(subtotal - discountSatang, vatRate);
  if (total > MAX_TOTAL_SATANG) throw new BadRequestException('Document total is too large');
  return { amounts, subtotal, discount: discountSatang, net: subtotal - discountSatang, vat, total };
}

export const DOC_PREFIX: Record<SalesDocType, string> = { quotation: 'QT', billing_note: 'BN' };

/** QT-2026-0001: numbered per document type and calendar year of the document date. */
export const formatDocNo = (docType: SalesDocType, docDate: string, seq: number) =>
  `${DOC_PREFIX[docType]}-${docDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`;

/** YYYY-MM-DD plus a number of calendar days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Quotation status changes a user can make (void is separate and Admin-only). A sent quotation can
 * go back to draft for revision.
 */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'draft'],
  accepted: [],
  rejected: [],
  void: [],
};

export function assertQuotationTransition(from: QuotationStatus, to: QuotationStatus) {
  if (!QUOTATION_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Cannot change a ${from} quotation to ${to}`);
  }
}
