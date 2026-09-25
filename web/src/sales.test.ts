import { describe, expect, it } from 'vitest';
import { bahtText, branchLabel, docStatus, documentTotals, lineAmount, parseQuantity } from './sales';

describe('bahtText', () => {
  it.each([
    [0, 'ศูนย์บาทถ้วน'],
    [100, 'หนึ่งบาทถ้วน'],
    [1100, 'สิบเอ็ดบาทถ้วน'],
    [2100, 'ยี่สิบเอ็ดบาทถ้วน'],
    [10100, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    [2000000, 'สองหมื่นบาทถ้วน'],
    [3210000, 'สามหมื่นสองพันหนึ่งร้อยบาทถ้วน'],
    [125050, 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์'],
    [101, 'หนึ่งบาทหนึ่งสตางค์'],
    [121, 'หนึ่งบาทยี่สิบเอ็ดสตางค์'],
    [100000000, 'หนึ่งล้านบาทถ้วน'],
    [100000100, 'หนึ่งล้านเอ็ดบาทถ้วน'],
    [1234567890123, 'หนึ่งหมื่นสองพันสามร้อยสี่สิบห้าล้านหกแสนเจ็ดหมื่นแปดพันเก้าร้อยเอ็ดบาทยี่สิบสามสตางค์'],
  ])('%i satang -> %s', (satang, text) => {
    expect(bahtText(satang)).toBe(text);
  });
});

describe('quantities and totals', () => {
  it('parses quantities with up to 2 decimals', () => {
    expect(parseQuantity('12')).toBe(1200);
    expect(parseQuantity('2.5')).toBe(250);
    expect(parseQuantity('1,000.25')).toBe(100025);
    expect(parseQuantity('1.234')).toBeNull();
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('-1')).toBeNull();
  });

  it('rounds line amounts half up like the API', () => {
    expect(lineAmount(150, 19999)).toBe(29999); // 1.5 × 199.99 = 299.985
    expect(lineAmount(1200, 50000)).toBe(600000);
  });

  it('takes the discount off before VAT', () => {
    expect(documentTotals([3000000, 600000], 100000, 7)).toEqual({ subtotal: 3600000, net: 3500000, vat: 245000, total: 3745000 });
    expect(documentTotals([399950], 0, 7)).toMatchObject({ vat: 27997, total: 427947 });
    expect(documentTotals([399950], 0, 0)).toMatchObject({ vat: 0, total: 399950 });
  });
});

describe('document status', () => {
  const today = '2026-09-25';

  it('derives expired quotations and overdue billing notes from the dates', () => {
    expect(docStatus('quotation', 'sent', '2026-09-24', today).label).toBe('หมดอายุ');
    expect(docStatus('quotation', 'sent', '2026-09-25', today).label).toBe('รอลูกค้าตอบรับ');
    expect(docStatus('quotation', 'accepted', '2026-01-01', today).label).toBe('ลูกค้าตอบรับ');
    expect(docStatus('billing_note', 'issued', '2026-09-01', today)).toEqual({ label: 'เกินกำหนดชำระ', tone: 'red' });
    expect(docStatus('billing_note', 'paid', '2026-09-01', today).label).toBe('ชำระแล้ว');
  });

  it('labels branches', () => {
    expect(branchLabel('00000')).toBe('สำนักงานใหญ่');
    expect(branchLabel('00012')).toBe('สาขาที่ 00012');
    expect(branchLabel(null)).toBeNull();
  });
});
