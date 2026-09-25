import { AccountType } from '../database/entities';

/** Starter chart of accounts seeded for every new tenant (Thai SME layout). */
export const DEFAULT_CHART: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'เงินสด', type: 'asset' },
  { code: '1010', name: 'เงินฝากธนาคาร', type: 'asset' },
  { code: '1100', name: 'ลูกหนี้การค้า', type: 'asset' },
  { code: '1200', name: 'สินค้าคงเหลือ', type: 'asset' },
  { code: '1300', name: 'ภาษีซื้อ', type: 'asset' },
  { code: '1500', name: 'อุปกรณ์สำนักงาน', type: 'asset' },
  { code: '2000', name: 'เจ้าหนี้การค้า', type: 'liability' },
  { code: '2100', name: 'ภาษีขาย', type: 'liability' },
  { code: '2200', name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', type: 'liability' },
  { code: '3000', name: 'ทุนจดทะเบียน', type: 'equity' },
  { code: '3100', name: 'กำไร (ขาดทุน) สะสม', type: 'equity' },
  { code: '4000', name: 'รายได้จากการขาย', type: 'revenue' },
  { code: '4100', name: 'รายได้จากการให้บริการ', type: 'revenue' },
  { code: '4900', name: 'รายได้อื่น', type: 'revenue' },
  { code: '5000', name: 'ต้นทุนขาย', type: 'expense' },
  { code: '5100', name: 'เงินเดือนและค่าจ้าง', type: 'expense' },
  { code: '5200', name: 'ค่าเช่า', type: 'expense' },
  { code: '5300', name: 'ค่าสาธารณูปโภค', type: 'expense' },
  { code: '5900', name: 'ค่าใช้จ่ายเบ็ดเตล็ด', type: 'expense' },
];
