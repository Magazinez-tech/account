// Browser smoke test for the web app. Needs the API (:3000) and Vite (:5173) running, and Edge (or E2E_BROWSER=chrome).
// Usage: npm run e2e   (screenshots land in e2e/screenshots/)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.WEB_URL ?? 'http://localhost:5173';
const shots = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(shots, { recursive: true });
const slug = `ui-test-${Math.random().toString(36).slice(2, 8)}`;
let failures = 0;
/** On GitHub Actions, failures also become annotations so they show on the run summary without opening the log. */
const annotate = (message) => {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=Browser E2E::${String(message).replace(/\r?\n/g, '%0A').slice(0, 1500)}`);
};
const check = (name, ok, detail = '') => {
  if (!ok) {
    failures++;
    annotate(`${name} ${detail}`);
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${ok ? '' : detail}`);
};

/** Waits up to 5s for the locator to be visible (the UI loads data asynchronously; CI machines are slower). */
const seen = (locator, timeout = 5000) => locator.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
/** Polls an async condition for up to 5s. */
async function eventually(condition, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    if (await condition().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Installed browser to drive: msedge locally (ships with Windows), chrome on CI runners.
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true }).catch((err) => {
  annotate(`could not launch ${process.env.E2E_BROWSER ?? 'msedge'}: ${err.message.split('\n')[0]}`);
  throw err;
});
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
  check('empty journal state', await seen(page.getByText('ยังไม่มีรายการ')));

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
  check('add account shows success + 20 accounts', await seen(page.getByText('20 บัญชี')));
  check('child account shows parent', await seen(page.getByText('ภายใต้ 1010')));
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
  check('submit disabled when empty', await eventually(() => submit.isDisabled()));
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
  check('unbalanced shows difference', await seen(page.getByText('ผลต่าง 100.00 (เดบิตมากกว่า)')));
  check('submit disabled when unbalanced', await eventually(() => submit.isDisabled()));
  await credit.nth(2).fill('700.005');
  check('3-decimal amount flagged', await seen(page.getByText('จำนวนเงินไม่ถูกต้อง')));
  await credit.nth(2).fill('700');
  // Typing a debit on a credit line clears the credit
  await debit.nth(2).fill('5');
  check('debit clears credit on same line', await eventually(async () => (await credit.nth(2).inputValue()) === ''));
  await credit.nth(2).fill('700');
  check('debit cleared by credit', await eventually(async () => (await debit.nth(2).inputValue()) === ''));
  check('balanced indicator', await seen(page.getByText('✓ ยอดดุล')));
  await page.screenshot({ path: `${shots}04-journal-new.png`, fullPage: true });
  await submit.click();
  await page.getByText('บันทึกรายการ JV-1 แล้ว').waitFor();
  check('entry posted, flash shown', true);
  await page.getByText('ขายสินค้าเงินสด รวม VAT').waitFor();
  check('entry card shows total', await seen(page.getByText('10,700.00').first()));
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
  check('login remembers slug', await eventually(async () => (await page.getByLabel('รหัสบริษัท').inputValue()) === slug));
  await page.getByLabel('อีเมล').fill('admin@uitest.com');
  await page.getByLabel('รหัสผ่าน').fill('wrong-password');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.getByText('รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง').waitFor();
  check('bad password message', true);
  await page.getByLabel('รหัสผ่าน').fill('SecurePass123');
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.getByRole('heading', { name: 'สมุดรายวันทั่วไป' }).waitFor();
  check('login works', true);

  // Billing: trial -> failed payment -> paid Pro, through the mock gateway
  await page.getByText(/^ทดลองใช้ Starter · เหลือ 1[34] วัน$/).waitFor();
  check('header shows trial days left', true);
  await page.getByRole('link', { name: 'การชำระเงิน' }).click();
  await page.getByRole('heading', { name: 'แพ็กเกจ', exact: true }).waitFor();
  check('billing page lists 3 plans with VAT', await eventually(async () => (await page.getByText(/\+ VAT 7%/).count()) === 3));
  await page.getByRole('button', { name: 'เปลี่ยนเป็นแพ็กเกจนี้' }).first().click(); // Pro (plans sorted by price)
  await page.getByText('Mock Payment Gateway').waitFor();
  check('redirected to the gateway with the VAT-inclusive amount', (await page.locator('body').innerText()).includes('845.30'));
  await page.screenshot({ path: `${shots}07-mock-gateway.png` });
  await page.getByRole('button', { name: 'จำลองการชำระไม่สำเร็จ' }).click();
  await page.getByText(/ชำระเงินใบแจ้งหนี้ INV-000001 ไม่สำเร็จ/).waitFor();
  check('declined payment reported on return', true);
  await page.getByRole('button', { name: 'เปลี่ยนเป็นแพ็กเกจนี้' }).first().click();
  await page.getByRole('button', { name: 'ชำระเงินสำเร็จ' }).click();
  await page.getByText(/ชำระเงินใบแจ้งหนี้ INV-000002 สำเร็จ/).waitFor();
  check('successful payment reported on return', true);
  check(
    'Pro is now the current plan and active',
    (await eventually(async () => (await page.getByText('ปัจจุบัน', { exact: true }).count()) === 1)) &&
      (await seen(page.getByText('ใช้งาน', { exact: true }))),
  );
  check('invoice history shows paid + void', await eventually(async () => (await page.getByText('ชำระแล้ว', { exact: true }).count()) === 1) && await eventually(async () => (await page.getByText('ยกเลิก', { exact: true }).count()) === 1));
  await page.getByText(/^Pro · ต่ออายุ/).waitFor();
  check('header shows the paid plan', true);
  await page.screenshot({ path: `${shots}07-billing.png`, fullPage: true });

  // Expired access token -> refresh token keeps the session
  await page.evaluate(() => localStorage.setItem('acc.accessToken', 'garbage'));
  await page.getByRole('link', { name: 'ผังบัญชี' }).click();
  await page.getByText('20 บัญชี').waitFor();
  check('bad access token recovered via refresh', (await page.evaluate(() => localStorage.getItem('acc.accessToken'))) !== 'garbage');

  // Post an entry as Admin so the clerk has a posted (voidable) entry to look at.
  await page.getByRole('link', { name: 'สมุดรายวัน' }).click();
  await page.getByRole('button', { name: '+ บันทึกรายการ' }).click();
  await page.getByLabel('บัญชี', { exact: true }).nth(0).selectOption({ label: '5200 ค่าเช่า' });
  await page.getByLabel('เดบิต').nth(0).fill('5000');
  await page.getByLabel('บัญชี', { exact: true }).nth(1).selectOption({ label: '1010 เงินฝากธนาคาร' });
  await page.getByLabel('เครดิต').nth(1).fill('5000');
  await page.getByRole('button', { name: 'บันทึกรายการ' }).click();
  await page.getByText('บันทึกรายการ JV-2 แล้ว').waitFor();
  await page.getByText('JV-2', { exact: true }).waitFor();
  check('Admin sees void button', await seen(page.getByRole('button', { name: 'ยกเลิกรายการ' })));

  // Invite a User-role member through the users page
  await page.getByRole('link', { name: 'ผู้ใช้งาน' }).click();
  await page.getByText('1 คน').waitFor();
  check('users page lists the admin', await seen(page.getByText('(คุณ)')));
  await page.getByRole('button', { name: '+ เชิญผู้ใช้' }).click();
  await page.getByLabel('อีเมล').fill('clerk@uitest.com');
  await page.getByLabel('ชื่อ-นามสกุล').fill('พนักงานบัญชี');
  await page.getByRole('button', { name: 'สร้างลิงก์คำเชิญ' }).click();
  const link = await page.getByLabel('ลิงก์คำเชิญ').inputValue();
  check('invite creates a one-time link', /\/invite\/[\w-]{20,}$/.test(link), link);
  await page.getByText('คำเชิญที่รอตอบรับ').waitFor();
  check('pending invitation listed', true);
  await page.screenshot({ path: `${shots}08-invite.png`, fullPage: true });

  // Accept the invite as the new user
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await page.getByRole('heading', { name: 'เข้าสู่ระบบ' }).waitFor();
  await page.goto(link);
  await page.getByRole('heading', { name: 'เข้าร่วม บริษัท ทดสอบ UI จำกัด' }).waitFor();
  check('invite page shows email', await eventually(async () => (await page.getByLabel('อีเมล').inputValue()) === 'clerk@uitest.com'));
  await page.locator('input[type=password]').first().fill('ClerkPass123');
  await page.getByLabel('ยืนยันรหัสผ่าน').fill('ClerkPass12');
  check('password mismatch blocks submit', await eventually(() => page.getByRole('button', { name: 'เริ่มใช้งาน' }).isDisabled()));
  await page.getByLabel('ยืนยันรหัสผ่าน').fill('ClerkPass123');
  await page.screenshot({ path: `${shots}09-accept-invite.png` });
  await page.getByRole('button', { name: 'เริ่มใช้งาน' }).click();
  await page.getByText('JV-2').waitFor();
  check('accepting the invite signs the user in', page.url().endsWith('/journal'));
  check('User role shown in header', await seen(page.getByText('· User')));
  check('User sees no void button', await eventually(async () => (await page.getByRole('button', { name: 'ยกเลิกรายการ' }).count()) === 0));
  check('User can still open the entry form', await seen(page.getByRole('button', { name: '+ บันทึกรายการ' })));
  await page.getByRole('link', { name: 'ผังบัญชี' }).click();
  await page.getByText('20 บัญชี').waitFor();
  check('User sees no add-account button', await eventually(async () => (await page.getByRole('button', { name: '+ เพิ่มบัญชี' }).count()) === 0));
  check('User sees no users menu', await eventually(async () => (await page.getByRole('link', { name: 'ผู้ใช้งาน' }).count()) === 0));
  await page.screenshot({ path: `${shots}10-user-role.png` });
  await page.goto(`${BASE}/users`);
  await page.getByRole('heading', { name: 'สมุดรายวันทั่วไป' }).waitFor();
  check('User visiting /users is sent to the journal', page.url().endsWith('/journal'));
  await page.goto(link);
  await page.getByText('ลิงก์คำเชิญไม่ถูกต้อง ถูกยกเลิก หรือหมดอายุแล้ว').waitFor();
  check('used invite link shows an error', true);
  await page.goto(`${BASE}/journal`);

  // Financial statements (as the User role, which may read reports). Only JV-2 (rent 5,000) is posted.
  await page.getByRole('link', { name: 'งบกำไรขาดทุน' }).click();
  await page.getByText('ขาดทุนสุทธิ').waitFor();
  const is = await page.locator('table').innerText();
  check('income statement: rent 5,000, net loss (5,000.00)', is.includes('5200') && is.includes('(5,000.00)'), is);
  check('income statement excludes voided sale', !is.includes('4000'), is);
  await page.screenshot({ path: `${shots}11-income-statement.png`, fullPage: true });
  await page.getByRole('button', { name: 'ทั้งหมด' }).click();
  check('"all time" preset clears dates', await eventually(async () => (await page.getByLabel('ตั้งแต่วันที่').inputValue()) === ''));

  await page.getByRole('link', { name: 'งบฐานะการเงิน' }).click();
  await page.getByText('สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ').waitFor();
  const bs = await page.locator('main').innerText();
  check('balance sheet shows current-period loss', bs.includes('กำไร (ขาดทุน) งวดปัจจุบัน') && (bs.match(/\(5,000\.00\)/g) ?? []).length >= 4, bs);
  await page.screenshot({ path: `${shots}12-balance-sheet.png`, fullPage: true });
  await page.getByLabel('ณ วันที่').fill('2000-01-01');
  await page.getByText('ไม่มีรายการ').nth(2).waitFor();
  check('balance sheet before any entry: nothing listed', await eventually(async () => (await page.getByText('ไม่มีรายการ').count()) === 3));

  // Phone width
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'สมุดรายวัน' }).click();
  await page.getByText('ยกเลิกแล้ว').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('no horizontal page scroll at 390px', !overflow);
  await page.screenshot({ path: `${shots}13-mobile.png`, fullPage: true });
} catch (err) {
  failures++;
  console.log('FAIL (exception)', err.message.split('\n')[0]);
  annotate(`exception at ${page.url()}: ${err.message.split('\n').slice(0, 6).join(' | ')}`);
  await page.screenshot({ path: `${shots}error.png`, fullPage: true });
} finally {
  // Expected network errors: 401 (bad token/password), 409 (duplicate account), 404 (used invite link).
  const unexpected = consoleErrors.filter((e) => !/401|Unauthorized|409|Conflict|404|Not Found/.test(e));
  check('no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall passed');
  process.exit(failures ? 1 : 0);
}
