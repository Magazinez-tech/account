import { AccountType } from '../database/entities';

/** Starter chart of accounts seeded for every new tenant (Thai SME layout, TFRS for NPAEs). */
export const DEFAULT_CHART: { code: string; name: string; type: AccountType }[] = [
  // ─── หมวด 1 สินทรัพย์ ────────────────────────────────────────────────────────
  // สินทรัพย์หมุนเวียน
  { code: '1000', name: 'เงินสด',                                           type: 'asset' },
  { code: '1010', name: 'เงินฝากธนาคาร',                                    type: 'asset' },
  { code: '1020', name: 'เงินสดย่อย',                                       type: 'asset' },
  { code: '1100', name: 'ลูกหนี้การค้า',                                    type: 'asset' },
  { code: '1110', name: 'ค่าเผื่อหนี้สงสัยจะสูญ',                         type: 'asset' },
  { code: '1150', name: 'รายได้ค้างรับ',                                    type: 'asset' },
  { code: '1160', name: 'ค่าใช้จ่ายล่วงหน้า',                              type: 'asset' },
  { code: '1170', name: 'ภาษีถูกหัก ณ ที่จ่าย',                           type: 'asset' },
  { code: '1200', name: 'สินค้าคงเหลือ',                                    type: 'asset' },
  { code: '1300', name: 'ภาษีซื้อ',                                         type: 'asset' },
  // สินทรัพย์ไม่หมุนเวียน
  { code: '1400', name: 'เงินมัดจำจ่าย',                                   type: 'asset' },
  { code: '1500', name: 'อุปกรณ์สำนักงาน',                                  type: 'asset' },
  { code: '1505', name: 'ค่าเสื่อมราคาสะสม-อุปกรณ์สำนักงาน',              type: 'asset' },
  { code: '1510', name: 'คอมพิวเตอร์และอุปกรณ์',                           type: 'asset' },
  { code: '1515', name: 'ค่าเสื่อมราคาสะสม-คอมพิวเตอร์และอุปกรณ์',       type: 'asset' },
  { code: '1520', name: 'ยานพาหนะ',                                         type: 'asset' },
  { code: '1525', name: 'ค่าเสื่อมราคาสะสม-ยานพาหนะ',                     type: 'asset' },
  { code: '1530', name: 'ที่ดิน',                                           type: 'asset' },
  { code: '1540', name: 'อาคาร',                                            type: 'asset' },
  { code: '1545', name: 'ค่าเสื่อมราคาสะสม-อาคาร',                        type: 'asset' },

  // ─── หมวด 2 หนี้สิน ──────────────────────────────────────────────────────────
  // หนี้สินหมุนเวียน
  { code: '2000', name: 'เจ้าหนี้การค้า',                                  type: 'liability' },
  { code: '2100', name: 'ภาษีขาย',                                          type: 'liability' },
  { code: '2200', name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย',                     type: 'liability' },
  { code: '2300', name: 'ภาษีเงินได้นิติบุคคลค้างจ่าย',                   type: 'liability' },
  { code: '2400', name: 'ค่าใช้จ่ายค้างจ่าย',                             type: 'liability' },
  { code: '2410', name: 'เงินเดือนค้างจ่าย',                               type: 'liability' },
  { code: '2420', name: 'ประกันสังคมค้างจ่าย',                             type: 'liability' },
  { code: '2500', name: 'รายได้รับล่วงหน้า',                               type: 'liability' },
  { code: '2510', name: 'เงินมัดจำรับ',                                    type: 'liability' },
  { code: '2600', name: 'เงินกู้ยืมระยะสั้น',                              type: 'liability' },
  // หนี้สินไม่หมุนเวียน
  { code: '2700', name: 'เงินกู้ยืมระยะยาว',                               type: 'liability' },

  // ─── หมวด 3 ส่วนของเจ้าของ ───────────────────────────────────────────────────
  { code: '3000', name: 'ทุนจดทะเบียน',                                    type: 'equity' },
  { code: '3100', name: 'กำไร (ขาดทุน) สะสม',                             type: 'equity' },
  { code: '3200', name: 'สำรองตามกฎหมาย',                                  type: 'equity' },

  // ─── หมวด 4 รายได้ ────────────────────────────────────────────────────────────
  { code: '4000', name: 'รายได้จากการขาย',                                 type: 'revenue' },
  { code: '4100', name: 'รายได้จากการให้บริการ',                           type: 'revenue' },
  { code: '4200', name: 'ดอกเบี้ยรับ',                                     type: 'revenue' },
  { code: '4300', name: 'กำไรจากการจำหน่ายสินทรัพย์',                     type: 'revenue' },
  { code: '4900', name: 'รายได้อื่น',                                      type: 'revenue' },

  // ─── หมวด 5 ค่าใช้จ่าย ───────────────────────────────────────────────────────
  { code: '5000', name: 'ต้นทุนขาย',                                       type: 'expense' },
  { code: '5100', name: 'เงินเดือนและค่าจ้าง',                             type: 'expense' },
  { code: '5110', name: 'ประกันสังคม-นายจ้าง',                             type: 'expense' },
  { code: '5200', name: 'ค่าเช่า',                                          type: 'expense' },
  { code: '5300', name: 'ค่าสาธารณูปโภค',                                  type: 'expense' },
  { code: '5400', name: 'ค่าเสื่อมราคา',                                   type: 'expense' },
  { code: '5500', name: 'ดอกเบี้ยจ่าย',                                    type: 'expense' },
  { code: '5600', name: 'ค่าโฆษณาและการตลาด',                              type: 'expense' },
  { code: '5700', name: 'ค่าธรรมเนียมวิชาชีพ',                            type: 'expense' },
  { code: '5800', name: 'ภาษีเงินได้นิติบุคคล',                           type: 'expense' },
  { code: '5810', name: 'รายจ่ายต้องห้ามทางภาษี',                         type: 'expense' },
  { code: '5900', name: 'ค่าใช้จ่ายเบ็ดเตล็ด',                            type: 'expense' },
];
