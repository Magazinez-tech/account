import type { BillingNoteStatus, QuotationStatus, SalesDocType } from './api';

/** System VAT rate used for the live preview; the API applies the configured rate when saving. */
export const VAT_RATE = 7;

export const DOC_TYPES: Record<
  SalesDocType,
  { title: string; titleEn: string; path: string; api: string; dueLabel: string; issuerLabel: string; receiverLabel: string }
> = {
  quotation: {
    title: 'ใบเสนอราคา',
    titleEn: 'QUOTATION',
    path: '/quotations',
    api: '/quotations',
    dueLabel: 'ยืนราคาถึง',
    issuerLabel: 'ผู้เสนอราคา',
    receiverLabel: 'ผู้อนุมัติสั่งซื้อ',
  },
  billing_note: {
    title: 'ใบวางบิล',
    titleEn: 'BILLING NOTE',
    path: '/billing-notes',
    api: '/billing-notes',
    dueLabel: 'ครบกำหนดชำระ',
    issuerLabel: 'ผู้วางบิล',
    receiverLabel: 'ผู้รับวางบิล',
  },
};

type Tone = 'green' | 'amber' | 'red' | 'slate';

const QUOTATION_STATUS: Record<QuotationStatus, { label: string; tone: Tone }> = {
  draft: { label: 'ร่าง', tone: 'slate' },
  sent: { label: 'รอลูกค้าตอบรับ', tone: 'amber' },
  accepted: { label: 'ลูกค้าตอบรับ', tone: 'green' },
  rejected: { label: 'ลูกค้าปฏิเสธ', tone: 'red' },
  void: { label: 'ยกเลิก', tone: 'slate' },
};

const BILLING_NOTE_STATUS: Record<BillingNoteStatus, { label: string; tone: Tone }> = {
  draft: { label: 'ร่าง', tone: 'slate' },
  issued: { label: 'รอชำระ', tone: 'amber' },
  paid: { label: 'ชำระแล้ว', tone: 'green' },
  void: { label: 'ยกเลิก', tone: 'slate' },
};

/**
 * Badge for a document. Expiry and lateness are derived from the dates: a sent quotation past its
 * valid-until date shows as expired, an issued billing note past its due date as overdue.
 */
export function docStatus(docType: SalesDocType, status: string, dueDate: string | null, today: string): { label: string; tone: Tone } {
  const late = dueDate !== null && dueDate < today;
  if (docType === 'quotation') {
    if (status === 'sent' && late) return { label: 'หมดอายุ', tone: 'red' };
    return QUOTATION_STATUS[status as QuotationStatus];
  }
  if (status === 'issued' && late) return { label: 'เกินกำหนดชำระ', tone: 'red' };
  return BILLING_NOTE_STATUS[status as BillingNoteStatus];
}

export const statusOptions = (docType: SalesDocType) =>
  Object.entries(docType === 'quotation' ? QUOTATION_STATUS : BILLING_NOTE_STATUS).map(([value, s]) => ({ value, label: s.label }));

/** "00000" -> สำนักงานใหญ่, "00001" -> สาขาที่ 00001; null for customers without a branch. */
export const branchLabel = (code: string | null) => (code === null ? null : code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`);

// ---- Money --------------------------------------------------------------

/** "1.5" -> 150 hundredths; "" or invalid -> null. Quantities allow 2 decimals like money. */
export function parseQuantity(input: string): number | null {
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(input.replace(/,/g, '').trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Same rounding as the API: quantity × unit price, half up to the satang. */
export function lineAmount(quantityHundredths: number, unitPriceSatang: number): number {
  return Number((BigInt(quantityHundredths) * BigInt(unitPriceSatang) + 50n) / 100n);
}

/** Totals in satang, as the API computes them: discount before VAT, VAT rounds half up. */
export function documentTotals(amounts: number[], discount: number, vatRate: number) {
  const subtotal = amounts.reduce((s, a) => s + a, 0);
  const net = subtotal - discount;
  const vat = Math.round((net * vatRate) / 100);
  return { subtotal, net, vat, total: net + vat };
}

// ---- Thai baht text (e.g. หนึ่งพันบาทถ้วน) ---------------------------------

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** Reads 0-999,999; hasHigher says a millions part comes before it (so a trailing 1 is เอ็ด). */
function readGroup(n: number, hasHigher: boolean): string {
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const place = s.length - 1 - i;
    if (d === 0) continue;
    if (place === 0) out += d === 1 && (hasHigher || s.length > 1) ? 'เอ็ด' : DIGITS[d];
    else if (place === 1) out += (d === 1 ? '' : d === 2 ? 'ยี่' : DIGITS[d]) + 'สิบ';
    else out += DIGITS[d] + PLACES[place];
  }
  return out;
}

function readNumber(n: number): string {
  if (n === 0) return DIGITS[0];
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  return (millions > 0 ? readNumber(millions) + 'ล้าน' : '') + (rest > 0 ? readGroup(rest, millions > 0) : '');
}

/** Amount in words as printed on Thai documents: 1,250.50 -> หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์. */
export function bahtText(satang: number): string {
  const baht = Math.floor(satang / 100);
  const st = satang % 100;
  return `${readNumber(baht)}บาท${st === 0 ? 'ถ้วน' : `${readNumber(st)}สตางค์`}`;
}
