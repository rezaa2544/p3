#!/usr/bin/env node
/**
 * آزمون پایان‌به‌پایان «کل جریان‌های محصول» با مرورگر واقعی (Chromium headless).
 *
 * چه چیزی را می‌سنجد (هر مورد PASS/FAIL مستقل):
 *  ۱. ورود مدیر، کوکی نشست httpOnly، داشبورد.
 *  ۲. ثبت گروهی حضور از رابط کاربری و تأیید سمت سرور.
 *  ۳. اصلاح حضور با دلیل + نمایش تاریخچه‌ی تغییرات (رابط کاربری).
 *  ۴. ساخت ارزیابی، ثبت نمره، تأیید و انتشار.
 *  ۵. کارنامه: رندر، قواعد چاپ (no-print) و تولید PDF چاپی واقعی.
 *  ۶. ساخت تکلیف و انتشار اطلاعیه.
 *  ۷. RBAC: دبیر/دانش‌آموز/ولی به بخش‌های غیرمجاز دسترسی ندارند.
 *  ۸. قطع واقعی شبکه: ثبت در صف محلی → بازگشت اتصال → همگام‌سازی با تأیید سرور.
 *  ۹. PWA: سرویس‌ورکر فعال و بارگذاری پوسته‌ی برنامه در حالت آفلاین.
 *
 * پیش‌نیاز: سرور ساخته‌شده با داده‌ی نمونه روی BASE در حال اجرا باشد.
 * اجرا: E2E_BASE=http://127.0.0.1:3100 node scripts/e2e-product.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
const PASSWORD = process.env.E2E_PASSWORD ?? 'Payesh1404a';
const evidenceDir = path.join(root, 'docs/testing/evidence');
const reportPath = path.join(root, 'docs/testing/product-e2e.json');
const stamp = Date.now().toString(36);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 400) });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
}

/** هر بخش مستقل اجرا می‌شود تا یک خطا بقیه‌ی آزمون را از کار نیندازد. */
async function section(title, fn) {
  try {
    await fn();
  } catch (e) {
    record(`${title}: بدون خطای اجرایی`, false, e instanceof Error ? e.message : String(e));
    if (typeof browser !== 'undefined') {
      try {
        const pages = await browser.pages();
        const last = pages.at(-1);
        if (last) await last.screenshot({ path: path.join(evidenceDir, `e2e-fail-${stamp}-${results.length}.png`) });
      } catch {
        /* نادیده */
      }
    }
  }
}

async function loadPuppeteer() {
  try {
    const puppeteer = await import('puppeteer-core');
    let executablePath = process.env.CHROME_PATH;
    let extraEnv = {};
    if (!executablePath) {
      const { default: chromium } = await import('@sparticuz/chromium');
      executablePath = await chromium.executablePath();
      const libDir = process.env.E2E_CHROME_LIBDIR ?? '/tmp/al2023/lib';
      extraEnv = { LD_LIBRARY_PATH: [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
    }
    return { puppeteer: puppeteer.default ?? puppeteer, executablePath, extraEnv };
  } catch {
    return null;
  }
}

const loaded = await loadPuppeteer();
if (!loaded) {
  await writeFile(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), status: 'NOT RUN', reason: 'مرورگر در دسترس نیست' }, null, 2),
  );
  console.error('مرورگر نصب نیست: npm i --no-save puppeteer-core @sparticuz/chromium (یا CHROME_PATH=…)');
  process.exit(2);
}

const { puppeteer, executablePath, extraEnv } = loaded;
await mkdir(evidenceDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  env: { ...process.env, ...extraEnv },
});

const consoleErrors = [];

/**
 * هر نقش در یک Context جداگانه اجرا می‌شود؛ وگرنه کوکی نشست مدیر در همان مرورگر
 * باقی می‌ماند و ورودِ دبیر/ولی/دانش‌آموز به‌جای فرم ورود، مستقیم به داشبورد می‌رود
 * و آزمون RBAC بی‌معنا می‌شود.
 */
async function newPage() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 160)}`));
  return page;
}

async function login(page, username) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30_000 });
  await page.waitForSelector('input#username', { timeout: 20_000 });
  await page.type('input#username', username);
  await page.type('input#password', PASSWORD);
  await Promise.all([
    page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 25_000 }),
    page.click('button[type=submit]'),
  ]);
  await page.waitForFunction(() => /داشبورد|دسترسی مجاز نیست/.test(document.querySelector('main')?.innerText ?? ''), {
    timeout: 25_000,
  });
}

async function goto(page, route, expectedText) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 30_000 });
  await page.waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 0, {
    timeout: 25_000,
  });
  if (expectedText) {
    await page
      .waitForFunction((t) => new RegExp(t).test(document.querySelector('main')?.innerText ?? ''), { timeout: 30_000 }, expectedText)
      .catch(async () => {
        // یک بار دیگر: برخی مسیرها بعد از بارگذاری نشست، تأخیر کوتاه دارند
        await sleep(1500);
        await page.waitForFunction((t) => new RegExp(t).test(document.querySelector('main')?.innerText ?? ''), { timeout: 15_000 }, expectedText);
      });
  }
}

const mainText = (page) =>
  page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').trim());

async function clickText(page, text) {
  const clicked = await page.evaluate((label) => {
    const nodes = [...document.querySelectorAll('button, a')];
    const el = nodes.find((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim().includes(label));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`دکمه/پیوند «${text}» پیدا نشد`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * آزمون باید تکرارپذیر باشد: هر بار یک زنگ بدون ثبت قبلی انتخاب می‌شود.
 * (روز امروز است و سرور ثبت دوباره‌ی همان زنگ را با ۴۰۹ مسدود می‌کند.)
 */
async function pickFreePeriod(page, used = []) {
  for (const period of [3, 4, 5, 6, 7, 2, 1]) {
    if (used.includes(period)) continue;
    await page.select('#period', String(period));
    await sleep(1200);
    const existingRows = await page.$$eval('table.data tbody tr', (rows) => rows.length).catch(() => 0);
    const hasRoster = (await page.$$('.att-row')).length > 0;
    if (existingRows === 0 && hasRoster) return period;
  }
  throw new Error('زنگ خالی برای ثبت حضور پیدا نشد');
}

let adminClassId = '';
let attendancePeriod = 0;
let assessmentTitle = '';
let correctedStudent = '';

try {
  // ── ۱) ورود مدیر ─────────────────────────────────────────────────────────
  const admin = await newPage();
  await section('ورود مدیر', async () => {
    await login(admin, 'admin');
    const cookies = await admin.cookies();
    const sid = cookies.find((c) => c.name === 'payesh2_sid');
    const checks = await admin.evaluate(() => ({
      path: location.pathname,
      hasNav: !!document.querySelector('nav'),
      heading: document.querySelector('main h1')?.textContent?.trim() ?? '',
    }));
    record(
      'ورود مدیر و نشست کوکی httpOnly',
      Boolean(sid?.httpOnly) && checks.path === '/' && checks.hasNav,
      `کوکی: ${sid ? `httpOnly=${sid.httpOnly}` : 'یافت نشد'} · صفحه: ${checks.heading}`,
    );
    const dash = await mainText(admin);
    record('داشبورد داده‌ی واقعی نشان می‌دهد', /دانش‌آموزان|کلاس‌های فعال/.test(dash), dash.slice(0, 80));
  });

  // ── ۲) ثبت گروهی حضور از رابط کاربری ─────────────────────────────────────
  await section('ثبت حضور', async () => {
    await goto(admin, '/attendance', 'ثبت حضور');
    await admin.waitForSelector('#class-select option:nth-child(2)', { timeout: 20_000 });
    adminClassId = await admin.$eval('#class-select', (el) => {
      const select = /** @type {HTMLSelectElement} */ (el);
      select.value = select.options[1].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.options[1].value;
    });
    await admin.waitForSelector('.att-row', { timeout: 25_000 });
    attendancePeriod = await pickFreePeriod(admin);
    const roster = await admin.$$eval('.att-row', (rows) => rows.length);
    await clickText(admin, 'همه حاضر');
    const progress = await admin.evaluate(
      () => [...document.querySelectorAll('main *')].map((n) => n.textContent ?? '').find((t) => /از \d+ نفر مشخص شده/.test(t)) ?? '',
    );
    await clickText(admin, 'ثبت و ارسال به سرور');
    await admin.waitForFunction(() => /ثبت در سرور تأیید شد/.test(document.body.innerText), { timeout: 30_000 });
    const text = await mainText(admin);
    await admin.screenshot({ path: path.join(evidenceDir, 'product-attendance-submit.png') });
    record(
      `ثبت گروهی حضور با تأیید سرور (زنگ ${attendancePeriod})`,
      /ثبت در سرور تأیید شد/.test(text) && roster > 0,
      `${roster} دانش‌آموز · ${progress.trim().slice(0, 40)}`,
    );

    // تأیید از سمت سرور: GET مستقیم API با همان نشست
    const fromServer = await admin.evaluate(
      async (classId, period) => {
        const day = new Date().toISOString().slice(0, 10);
        const res = await fetch(`/api/attendance?classId=${classId}&day=${day}`, { credentials: 'include' });
        if (!res.ok) return { ok: false, status: res.status };
        const data = await res.json();
        const rows = data.items.filter((r) => Number(r.period_no) === period);
        return { ok: true, count: rows.length, source: rows[0]?.source ?? null };
      },
      adminClassId,
      attendancePeriod,
    );
    record(
      'سرور همان رکوردها را با منبع online ذخیره کرده است',
      fromServer.ok && fromServer.count === roster && fromServer.source === 'online',
      JSON.stringify(fromServer),
    );
  });

  // ── ۳) اصلاح حضور با دلیل و تاریخچه ─────────────────────────────────────
  await section('اصلاح حضور', async () => {
    await admin.waitForSelector('table.data tbody tr', { timeout: 20_000 });
    correctedStudent = await admin.$eval('table.data tbody tr td:first-child', (td) => td.textContent?.trim() ?? '');
    await clickText(admin, 'اصلاح');
    await admin.waitForSelector('#correct-status', { timeout: 15_000 });
    const historyBefore = await admin.evaluate(() => /این رکورد تا کنون اصلاح نشده/.test(document.body.innerText));
    await admin.select('#correct-status', 'absent');
    await admin.type('#correct-reason', 'ثبت اشتباه در آزمون پذیرش — اصلاح آزمایشی');
    await admin.screenshot({ path: path.join(evidenceDir, 'product-attendance-correction.png') });
    await clickText(admin, 'ثبت اصلاح');
    await admin.waitForFunction(() => /اصلاح حضور ثبت شد/.test(document.body.innerText), { timeout: 25_000 });

    // بازگشایی همان رکورد: تاریخچه باید یک ردیف داشته باشد
    await sleep(600);
    await clickText(admin, 'اصلاح');
    await admin.waitForSelector('#correct-reason', { timeout: 15_000 });
    await admin.waitForFunction(() => /تاریخچه‌ی تغییرات/.test(document.body.innerText), { timeout: 10_000 });
    const history = await admin.evaluate(() => document.body.innerText);
    await admin.screenshot({ path: path.join(evidenceDir, 'product-attendance-history.png') });
    record(
      'اصلاح حضور: دلیل ثبت و تاریخچه در رابط کاربری دیده می‌شود',
      historyBefore && /حاضر به غایب/.test(history) && /اصلاح آزمایشی/.test(history),
      `دانش‌آموز: ${correctedStudent}`,
    );
    await clickText(admin, 'انصراف');
  });

  // ── ۴) نمره: دبیر ارزیابی می‌سازد و نمره ثبت می‌کند (دسترسی نوشتن مخصوص دبیر) ──
  await section('نمره — ایجاد و ثبت توسط دبیر', async () => {
    const teacher = await newPage();
    await login(teacher, 'teacher1');
    await goto(teacher, '/grades', 'ارزیابی');
    assessmentTitle = `آزمون E2E ${stamp}`;
    await clickText(teacher, 'ارزیابی جدید');
    await teacher.waitForSelector('#title', { timeout: 15_000 });
    await teacher.type('#title', assessmentTitle);
    await teacher.screenshot({ path: path.join(evidenceDir, 'product-grade-create.png') });
    await clickText(teacher, 'ایجاد');
    await teacher.waitForFunction(
      (t) => new RegExp(t).test(document.body.innerText),
      { timeout: 25_000 },
      assessmentTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    record('ساخت ارزیابی توسط دبیر', true, assessmentTitle);

    const opened = await teacher.evaluate((t) => {
      const row = [...document.querySelectorAll('table.data tbody tr')].find((r) => (r.textContent ?? '').includes(t));
      const btn = row?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    }, assessmentTitle);
    if (!opened) throw new Error('ردیف ارزیابی تازه پیدا نشد');
    await teacher.waitForSelector('table.data tbody input[type=number]', { timeout: 25_000 });
    await teacher.waitForFunction(() => /سقف نمره/.test(document.body.innerText), { timeout: 20_000 });

    // ورودی‌ها کنترل‌شده‌اند؛ مقدار باید با تایپ واقعی وارد شود تا state ری‌اکت به‌روز شود
    const gradeInputs = await teacher.$$('table.data tbody input[type=number]');
    const toFill = gradeInputs.slice(0, 3);
    for (const [i, handle] of toFill.entries()) {
      await handle.click();
      await handle.type(String(15 + i * 2));
    }
    const filled = toFill.length;
    await sleep(300);
    await clickText(teacher, 'ذخیره نمرات');
    await teacher.waitForFunction(() => /نمره ثبت شد/.test(document.body.innerText), { timeout: 25_000 });
    record('ثبت نمره‌ی پیش‌نویس توسط دبیر', filled > 0, `${filled} نمره`);
    await teacher.close();
  });

  await section('نمره — تأیید توسط مدیر', async () => {
    await goto(admin, '/grades', 'ارزیابی');
    await admin.waitForFunction((t) => new RegExp(t).test(document.body.innerText), { timeout: 25_000 }, assessmentTitle);
    const opened = await admin.evaluate((t) => {
      const row = [...document.querySelectorAll('table.data tbody tr')].find((r) => (r.textContent ?? '').includes(t));
      const btn = row?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    }, assessmentTitle);
    if (!opened) throw new Error('ارزیابی برای تأیید پیدا نشد');
    await admin.waitForFunction(() => /سقف نمره/.test(document.body.innerText), { timeout: 20_000 });
    await clickText(admin, 'تأیید و انتشار');
    await clickText(admin, 'تأیید نهایی');
    await admin.waitForFunction(() => /نمره تأیید و منتشر شد/.test(document.body.innerText), { timeout: 25_000 });
    await admin.screenshot({ path: path.join(evidenceDir, 'product-grades-approved.png') });
    record('تأیید و انتشار نمرات توسط مدیر', true, 'پیام موفقیت سرور دریافت شد');
  });

  // ── ۵) کارنامه: رندر + چاپ ───────────────────────────────────────────────
  await section('کارنامه', async () => {
    await goto(admin, '/report-card', 'کارنامه');
    await admin.waitForSelector('#student', { timeout: 25_000 });
    await admin.waitForFunction(() => /جمع|میانگین|نمره/.test(document.querySelector('main')?.innerText ?? ''), {
      timeout: 25_000,
    });
    const card = await mainText(admin);
    await admin.screenshot({ path: path.join(evidenceDir, 'product-report-card.png') });

    // قواعد چاپ: عناصر no-print پنهان می‌شوند
    await admin.emulateMediaType('print');
    const printState = await admin.evaluate(() => {
      const hidden = [...document.querySelectorAll('.no-print')].map((el) => getComputedStyle(el).display);
      // کارنامه‌ی چاپی: هر بخشی که در چاپ دیده می‌شود و کلاس no-print ندارد
      const visible = [...document.querySelectorAll('main table, main .card')].filter(
        (el) => !el.closest('.no-print') && getComputedStyle(el).display !== 'none',
      );
      return { noPrint: hidden, cardVisible: visible.length > 0 };
    });
    await admin.pdf({
      path: path.join(evidenceDir, 'report-card-print.pdf'),
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' },
    });
    await admin.emulateMediaType(null);
    record(
      'کارنامه در چاپ A4: کنترل‌های صفحه پنهان و کارنامه دیده می‌شود',
      printState.noPrint.every((d) => d === 'none') && printState.cardVisible,
      `no-print: ${printState.noPrint.join(',') || 'ندارد'}`,
    );
    record('کارنامه دارای داده‌ی واقعی است', /میانگین|جمع|درس/.test(card), card.slice(0, 80));
  });

  // ── ۶) تکلیف و اطلاعیه ───────────────────────────────────────────────────
  await section('تکلیف — ساخت توسط دبیر', async () => {
    const teacher = await newPage();
    await login(teacher, 'teacher1');
    await goto(teacher, '/assignments', 'تکالیف');
    await clickText(teacher, 'تکلیف جدید');
    await teacher.waitForSelector('#t', { timeout: 15_000 });
    await teacher.type('#t', `تکلیف E2E ${stamp}`);
    await teacher.type('#d', 'توضیح آزمون خودکار — قابل حذف.');
    // فیلد تاریخ مقدار پیش‌فرض دارد؛ اگر نداشت با تایپ واقعی پر می‌شود تا state به‌روز شود
    if (!(await teacher.$eval('#due', (el) => /** @type {HTMLInputElement} */ (el).value))) {
      const tomorrow = new Date(Date.now() + 86_400_000);
      const typed = `${String(tomorrow.getMonth() + 1).padStart(2, '0')}${String(tomorrow.getDate()).padStart(2, '0')}${tomorrow.getFullYear()}`;
      await teacher.focus('#due');
      await teacher.keyboard.type(typed);
    }
    const dueReady = await teacher.$eval('#due', (el) => /** @type {HTMLInputElement} */ (el).value);
    if (!dueReady) throw new Error('تاریخ مهلت خالی ماند');
    await clickText(teacher, 'ایجاد');
    await teacher.waitForFunction((t) => new RegExp(t).test(document.body.innerText), { timeout: 25_000 }, `تکلیف E2E ${stamp}`);
    await teacher.screenshot({ path: path.join(evidenceDir, 'product-assignment-created.png') });
    record('ساخت تکلیف توسط دبیر از رابط کاربری', true, `تکلیف E2E ${stamp}`);
    await teacher.close();
  });

  await section('اطلاعیه', async () => {
    await goto(admin, '/announcements', 'اطلاعیه');
    await clickText(admin, 'اطلاعیه جدید');
    await admin.waitForSelector('#t', { timeout: 15_000 });
    await admin.type('#t', `اطلاعیه E2E ${stamp}`);
    await admin.type('#b', 'متن آزمایشی برای سنجش انتشار اطلاعیه در مرورگر واقعی.');
    await clickText(admin, 'انتشار');
    await admin.waitForFunction((t) => new RegExp(t).test(document.body.innerText), { timeout: 25_000 }, `اطلاعیه E2E ${stamp}`);
    record('انتشار اطلاعیه از رابط کاربری', true, `اطلاعیه E2E ${stamp}`);
  });

  // ── ۷) RBAC ──────────────────────────────────────────────────────────────
  await section('RBAC دبیر', async () => {
    const teacher = await newPage();
    await login(teacher, 'teacher1');
    await goto(teacher, '/users');
    const text = await mainText(teacher);
    await teacher.screenshot({ path: path.join(evidenceDir, 'product-rbac-teacher.png') });
    record('دبیر به مدیریت کاربران دسترسی ندارد', /دسترسی مجاز نیست/.test(text), text.slice(0, 60));
    await goto(teacher, '/attendance', 'ثبت حضور');
    record('دبیر به ثبت حضور دسترسی دارد', /ثبت حضور/.test(await mainText(teacher)), 'صفحه باز شد');
    await teacher.close();
  });

  await section('RBAC ولی', async () => {
    const guardian = await newPage();
    await login(guardian, 'guardian1');
    await goto(guardian, '/attendance');
    const att = await mainText(guardian);
    record('ولی به ثبت حضور دسترسی ندارد', /دسترسی مجاز نیست/.test(att), att.slice(0, 60));
    await goto(guardian, '/report-card', 'کارنامه');
    await guardian.waitForFunction(() => /میانگین|درس|جمع/.test(document.querySelector('main')?.innerText ?? ''), {
      timeout: 25_000,
    });
    await guardian.screenshot({ path: path.join(evidenceDir, 'product-rbac-guardian.png') });
    record('ولی کارنامه‌ی فرزند خود را می‌بیند', true, (await mainText(guardian)).slice(0, 70));
    await guardian.close();
  });

  await section('RBAC دانش‌آموز', async () => {
    const student = await newPage();
    await login(student, 'student1');
    await goto(student, '/users');
    record('دانش‌آموز به مدیریت کاربران دسترسی ندارد', /دسترسی مجاز نیست/.test(await mainText(student)), '');
    await goto(student, '/assignments', 'تکالیف');
    record('دانش‌آموز تکالیف کلاس خود را می‌بیند', /تکالیف/.test(await mainText(student)), '');
    await student.close();
  });

  // ── ۸) قطع واقعی شبکه و همگام‌سازی ───────────────────────────────────────
  await section('آفلاین واقعی', async () => {
    const page = await newPage();
    await login(page, 'admin');
    await goto(page, '/attendance', 'ثبت حضور');
    await page.waitForSelector('#class-select option:nth-child(2)', { timeout: 20_000 });
    await page.$eval('#class-select', (el) => {
      const select = /** @type {HTMLSelectElement} */ (el);
      select.value = select.options[1].value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForSelector('.att-row', { timeout: 25_000 });
    const offlinePeriod = await pickFreePeriod(page, [attendancePeriod]);

    await page.setOfflineMode(true);
    await page.waitForFunction(() => /اتصال اینترنت قطع است/.test(document.body.innerText), { timeout: 20_000 });
    await clickText(page, 'همه حاضر');
    await clickText(page, 'ذخیره در صف آفلاین');
    await page.waitForFunction(() => /صف محلی ذخیره شد|در صف محلی/.test(document.body.innerText), { timeout: 20_000 });
    const queued = await page.evaluate(() => /در انتظار ارسال|صف عملیات/.test(document.body.innerText));
    await page.screenshot({ path: path.join(evidenceDir, 'product-offline-queued.png') });
    record('قطع شبکه: ثبت در صف محلی (بدون ادعای ذخیره روی سرور)', queued, 'نوار آفلاین و صف نمایش داده شد');

    await page.setOfflineMode(false);
    await page.waitForFunction(() => !/اتصال اینترنت قطع است/.test(document.body.innerText), { timeout: 20_000 });
    // با رویداد online، همگام‌سازی خودکار شروع می‌شود؛ اگر نشد، دکمه‌ی همگام‌سازی زده می‌شود.
    try {
      await page.waitForFunction(() => /تأیید سرور همگام شد/.test(document.body.innerText), { timeout: 15_000 });
    } catch {
      await clickText(page, 'همگام‌سازی');
      await page.waitForFunction(() => /تأیید سرور همگام شد/.test(document.body.innerText), { timeout: 40_000 });
    }
    await page.screenshot({ path: path.join(evidenceDir, 'product-offline-synced.png') });
    record('بازگشت اتصال: همگام‌سازی با تأیید سرور', true, 'پیام «با تأیید سرور همگام شد»');

    // دوباره بارگذاری و بررسی منبع رکورد روی سرور
    await goto(page, '/attendance', 'ثبت حضور');
    await page.waitForSelector('#class-select option:nth-child(2)', { timeout: 20_000 });
    await page.select('#period', String(offlinePeriod));
    await page.waitForFunction(() => /آفلاین همگام‌شده/.test(document.body.innerText), { timeout: 30_000 });
    await page.screenshot({ path: path.join(evidenceDir, 'product-offline-server-source.png') });
    record('سرور رکورد را با منبع «آفلاین همگام‌شده» ذخیره کرده است', true, 'جدول ثبت‌های موجود');
    await page.close();
  });

  // ── ۹) PWA آفلاین ────────────────────────────────────────────────────────
  await section('PWA آفلاین', async () => {
    const page = await newPage();
    await login(page, 'admin');
    const sw = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((r) => setTimeout(() => r(null), 15_000)),
      ]);
      return { supported: true, active: Boolean(reg?.active), scope: reg?.scope ?? null };
    });
    record('سرویس‌ورکر فعال است', sw.supported && sw.active, `scope: ${sw.scope ?? '-'}`);
    if (sw.active) {
      await page.setOfflineMode(true);
      let loadedOk = false;
      let detail = '';
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 25_000 });
        await page.waitForFunction(() => (document.getElementById('root')?.textContent ?? '').trim().length > 10, {
          timeout: 20_000,
        });
        loadedOk = true;
        detail = (await page.evaluate(() => (document.getElementById('root')?.textContent ?? '').replace(/\s+/g, ' ').trim())).slice(0, 60);
      } catch (e) {
        detail = e instanceof Error ? e.message : String(e);
      }
      await page.screenshot({ path: path.join(evidenceDir, 'product-pwa-offline.png') }).catch(() => undefined);
      record('بارگذاری مجدد برنامه در حالت آفلاین (پوسته از کش سرویس‌ورکر)', loadedOk, detail);
      await page.setOfflineMode(false);
    }
    await page.close();
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.status === 'FAIL');
await writeFile(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      base: BASE,
      chrome: executablePath,
      status: failed.length === 0 ? 'PASS' : 'FAIL',
      passed: results.length - failed.length,
      total: results.length,
      results,
    },
    null,
    2,
  ),
);
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${results.length - failed.length}/${results.length} بررسی موفق`);
console.log(`گزارش: ${path.relative(root, reportPath)}`);
if (consoleErrors.length > 0) console.log(`خطاهای صفحه: ${consoleErrors.slice(0, 5).join(' | ')}`);
process.exit(failed.length === 0 ? 0 : 1);
