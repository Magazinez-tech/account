// Browser smoke test for the web app. Needs the API (:3000) and Vite (:5173) running, Microsoft Edge,
// psql (to seed a User-role member) and the root npm install (for bcryptjs).
// Usage: npm run e2e   (screenshots land in e2e/screenshots/)
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const PSQL = process.env.PSQL ?? 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe';
// bcryptjs comes from the API's node_modules in the repo root.
const bcrypt = createRequire(new URL('../../package.json', import.meta.url))('bcryptjs');
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });
const slug = `ui-test-${Math.random().toString(36).slice(2, 8)}`;
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : detail}`);
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(e.message));

try {
  // Unauthenticated -> login
  await page.goto(`${BASE}/trial-balance`);
  await page.getByRole('heading', { name: 'เข้าสู่ระบบ' }).waitFor();
  check('protected route redirects to /login', page.url().endsWith('/login'));
  await page.screenshot({ path: `${shots}01-login.png` });

  // Signup
  await page.getByRole('link', { name: 'สมัครใช้งานฟรี 14 วัน' }).click();
  await page.getByLabel('ชื่อบริษัท').fill('บริษัท ทดสอบ UI จำกัด');
  await page.getByLabel('รหัสบริษัท').fill(slug);
  await page.getByLabel('ชื่อผู้ดูแลระบบ').fill('สมชาย ใจดี');
  await page.getByLabel('อีเมล').fill('admin@uitest.com');
  await page.getByLabel('รหัสผ่าน').fill('SecurePass123');
  await page.screenshot({ path: `${shots}02-signup.png` });
  await page.getByRole('button', { name: 'สร้างบัญชี' }).click();
  await page.getByRole('heading', { name: 'สมุดรายวันทั่วไป' }).waitFor();
  check('signup lands on journal', page.url().endsWith('/journal'));
  await page.getByText('บริษัท ทดสอบ UI จำกัด').waitFor();
  check('header shows company name', true);
  check('empty journal state', await page.getByText('ยังไม่มีรายการ').isVisible());

  // Chart of accounts
  await page.getByRole('link', { name: 'ผังบัญชี' }).click();
  await page.getByText('19 บัญชี').waitFor();
  check('chart of accounts shows 19 seeded accounts', true);
  await page.getByRole('button', { name: '+ เพิ่มบัญชี' }).click();
  await page.getByLabel('รหัสบัญชี').fill('1020');
  await page.getByLabel('ชื่อบัญชี').fill('เงินฝากออมทรัพย์');
  await page.getByLabel('บัญชีแม่ (ไม่บังคับ)').selectOption({ label: '1010 เงินฝากธนาคาร' });
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.getByText('เพิ่มบัญชี 1020 เงินฝากออมทรัพย์ แล้ว').waitFor();
  check('add account shows success + 20 accounts', await page.getByText('20 บัญชี').isVisible());
  check('child account shows parent', await page.getByText('ภายใต้ 1010').isVisible());
  // Duplicate code -> 409 message
  await page.getByRole('button', { name: '+ เพิ่มบัญชี' }).click();
  await page.getByLabel('รหัสบัญชี').fill('1020');
  await page.getByLabel('ชื่อบัญชี').fill('ซ้ำ');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await page.getByText('Account code 1020 already exists').waitFor();
  check('duplicate account code shows server error', true);
  await page.screenshot({ path: `${shots}03-accounts.png`, fullPage: true });
  await page.getByRole('button', { name: 'ยกเลิก' }).click();

  // New journal entry
  await page.getByRole('link', { name: 'สมุดรายวัน' }).click();
  await page.getByRole('button', { name: '+ บันทึกรายการ' }).click();
  await page.getByLabel('เลขที่อ้างอิง').fill('INV-0001');
  await page.getByLabel('คำอธิบาย', { exact: true }).fill('ขายสินค้าเงินสด รวม VAT');
  const submit = page.getByRole('button', { name: 'บันทึกรายการ' });
  check('submit disabled when empty', await submit.isDisabled());
  await page.getByRole('button', { name: '+ เพิ่มบรรทัด' }).click();
  const acct = page.getByLabel('บัญชี', { exact: true });
  const debit = page.getByLabel('เดบิต');
  const credit = page.getByLabel('เครดิต');
  await acct.nth(0).selectOption({ label: '1000 เงินสด' });
  await debit.nth(0).fill('10,700');
  await acct.nth(1).selectOption({ label: '4000 รายได้จากการขาย' });
  await credit.nth(1).fill('10000');
  await acct.nth(2).selectOption({ label: '2100 ภาษีขาย' });
  await credit.nth(2).fill('600');
  check('unbalanced shows difference', await page.getByText('ผลต่าง 100.00 (เดบิตมากกว่า)').isVisible());
  check('submit disabled when unbalanced', await submit.isDisabled());
  await credit.nth(2).fill('700.005');
  check('3-decimal amount flagged', await page.getByText('จำนวนเงินไม่ถูกต้อง').isVisible());
  await credit.nth(2).fill('700');
  // Typing a debit on a credit line clears the credit
  await debit.nth(2).fill('5');
  check('debit clears credit on same line', (await credit.nth(2).inputValue()) === '');
  await credit.nth(2).fill('700');
  check('debit cleared by credit', (await debit.nth(2).inputValue()) === '');
  check('balanced indicator', await page.getByText('✓ ยอดดุล').isVisible());
  await page.screenshot({ path: `${shots}04-journal-new.png`, fullPage: true });
  await submit.click();
  await page.getByText('บันทึกรายการ JV-1 แล้ว').waitFor();
  check('entry posted, flash shown', true);
  await page.getByText('ขายสินค้าเงินสด รวม VAT').waitFor();
  check('entry card shows total', await page.getByText('10,700.00').first().isVisible());
  await page.screenshot({ path: `${shots}05-journal-list.png`, fullPage: true });

  // Trial balance
  await page.getByRole('link', { name: 'งบทดลอง' }).click();
  await page.getByText('ยอดดุล', { exact: true }).waitFor();
  const tfoot = await page.locator('tfoot').innerText();
  check('trial balance totals 10,700 / 10,700', (tfoot.match(/10,700\.00/g) ?? []).length === 2, tfoot);
  await page.screenshot({ path: `${shots}06-trial-balance.png`, fullPage: true });
  await page.getByLabel('ณ วันที่').fill('2000-01-01');
  await page.getByText('ยังไม่มียอดคงเหลือ').waitFor();
  check('as-of date before entry -> empty', true);

  // Void
  await page.getByRole('link', { name: 'สมุดรายวัน' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'ยกเลิกรายการ' }).click();
  await page.getByText('ยกเลิกแล้ว').waitFor();
  check('void marks entry', true);
  await page.getByRole('link', { name: 'งบทดลอง' }).click();
  await page.getByText('ยังไม่มียอดคงเหลือ').waitFor();
  check('voided entry excluded from trial balance', true);

  // Logout / login
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.getByRole('heading', { name: 'เข้าสู่ระบบ' }).waitFor();
  check('login remembers slug', (await page.getByLabel('รหัสบริษัท').inputValue()) === slug);
  await page.getByLabel('อีเมล').fill('admin@uitest.com');
  await page.getByLabel('รหัสผ่าน').fill('wrong-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.getByText('รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง').waitFor();
  check('bad password message', true);
  await page.getByLabel('รหัสผ่าน').fill('SecurePass123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.getByRole('heading', { name: 'สมุดรายวันทั่วไป' }).waitFor();
  check('login works', true);

  // Expired access token -> refresh token keeps the session
  await page.evaluate(() => localStorage.setItem('acc.accessToken', 'garbage'));
  await page.getByRole('link', { name: 'ผังบัญชี' }).click();
  await page.getByText('20 บัญชี').waitFor();
  check('bad access token recovered via refresh', (await page.evaluate(() => localStorage.getItem('acc.accessToken'))) !== 'garbage');

  // User role: no Admin-only actions. There's no invite flow yet (TASK-11), so seed the member with psql.
  const hash = bcrypt.hashSync('ClerkPass123', 10);
  execFileSync(PSQL, ['-U', 'postgres', '-h', 'localhost', '-d', 'accounting_saas_dev', '-q', '-c',
    `WITH u AS (INSERT INTO users (tenant_id, email, full_name, password_hash)
       SELECT id, 'clerk@uitest.com', 'Clerk', '${hash}' FROM tenants WHERE slug = '${slug}' RETURNING id, tenant_id)
     INSERT INTO user_roles (user_id, role_id, tenant_id)
       SELECT u.id, r.id, u.tenant_id FROM u JOIN roles r ON r.tenant_id = u.tenant_id AND r.name = 'User'`],
    { env: { ...process.env, PGPASSWORD: 'postgres' } });
  // Post an entry as Admin so the clerk has a posted (voidable) entry to look at.
  await page.getByRole('link', { name: 'สมุดรายวัน' }).click();
  await page.getByRole('button', { name: '+ บันทึกรายการ' }).click();
  await page.getByLabel('บัญชี', { exact: true }).nth(0).selectOption({ label: '5200 ค่าเช่า' });
  await page.getByLabel('เดบิต').nth(0).fill('5000');
  await page.getByLabel('บัญชี', { exact: true }).nth(1).selectOption({ label: '1010 เงินฝากธนาคาร' });
  await page.getByLabel('เครดิต').nth(1).fill('5000');
  await page.getByRole('button', { name: 'บันทึกรายการ' }).click();
  await page.getByText('บันทึกรายการ JV-2 แล้ว').waitFor();
  check('Admin sees void button', await page.getByRole('button', { name: 'ยกเลิกรายการ' }).isVisible());

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.getByLabel('อีเมล').fill('clerk@uitest.com');
  await page.getByLabel('รหัสผ่าน').fill('ClerkPass123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.getByText('JV-2').waitFor();
  check('User role shown in header', await page.getByText('· User').isVisible());
  check('User sees no void button', (await page.getByRole('button', { name: 'ยกเลิกรายการ' }).count()) === 0);
  check('User can still open the entry form', await page.getByRole('button', { name: '+ บันทึกรายการ' }).isVisible());
  await page.getByRole('link', { name: 'ผังบัญชี' }).click();
  await page.getByText('20 บัญชี').waitFor();
  check('User sees no add-account button', (await page.getByRole('button', { name: '+ เพิ่มบัญชี' }).count()) === 0);
  await page.screenshot({ path: `${shots}08-user-role.png` });

  // Financial statements (as the User role, which may read reports). Only JV-2 (rent 5,000) is posted.
  await page.getByRole('link', { name: 'งบกำไรขาดทุน' }).click();
  await page.getByText('ขาดทุนสุทธิ').waitFor();
  const is = await page.locator('table').innerText();
  check('income statement: rent 5,000, net loss (5,000.00)', is.includes('5200') && is.includes('(5,000.00)'), is);
  check('income statement excludes voided sale', !is.includes('4000'), is);
  await page.screenshot({ path: `${shots}09-income-statement.png`, fullPage: true });
  await page.getByRole('button', { name: 'ทั้งหมด' }).click();
  check('"all time" preset clears dates', (await page.getByLabel('ตั้งแต่วันที่').inputValue()) === '');

  await page.getByRole('link', { name: 'งบแสดงฐานะการเงิน' }).click();
  await page.getByText('สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ').waitFor();
  const bs = await page.locator('main').innerText();
  check('balance sheet shows current-period loss', bs.includes('กำไร (ขาดทุน) งวดปัจจุบัน') && (bs.match(/\(5,000\.00\)/g) ?? []).length >= 4, bs);
  await page.screenshot({ path: `${shots}10-balance-sheet.png`, fullPage: true });
  await page.getByLabel('ณ วันที่').fill('2000-01-01');
  await page.getByText('ไม่มีรายการ').nth(2).waitFor();
  check('balance sheet before any entry: nothing listed', (await page.getByText('ไม่มีรายการ').count()) === 3);

  // Phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'สมุดรายวัน' }).click();
  await page.getByText('ยกเลิกแล้ว').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('no horizontal page scroll at 390px', !overflow);
  await page.screenshot({ path: `${shots}07-mobile.png`, fullPage: true });
} catch (err) {
  failures++;
  console.log('FAIL (exception)', err.message.split('\n')[0]);
  await page.screenshot({ path: `${shots}error.png`, fullPage: true });
} finally {
  // 401s from the deliberate bad token/password are expected network errors.
  const unexpected = consoleErrors.filter((e) => !/401|Unauthorized|409|Conflict/.test(e));
  check('no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
