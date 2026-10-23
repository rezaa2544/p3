#!/usr/bin/env node
/**
 * آزمون پایان‌به‌پایان «نسخهٔ میزکار» با مرورگر واقعی (Chromium headless).
 *
 * این آزمون همان چیزی را می‌سنجد که کاربر ویندوزی پس از نصب می‌بیند، ولی روی نسخهٔ
 * لینوکسیِ همان کد (همان SEA و همان باندل) اجرا می‌شود:
 *   ۱. صفحهٔ ورود فارسی/RTL روی ۱۲۷٫۰٫۰٫۱ باز می‌شود.
 *   ۲. ورود با اعتبارنامهٔ نخستین اجرای میزکار (۱۲۳۴۵۶/۱۲۳۴۵۶) کار می‌کند.
 *   ۳. سامانه تغییر رمز را اجباری نشان می‌دهد و رمز کوتاه را نمی‌پذیرد.
 *   ۴. کوکی نشست httpOnly و Secure است (چون ۱۲۷٫۰٫۰۱ مبدأ امن است) و در جاوااسکریپت دیده نمی‌شود.
 *   ۵. نشست پس از بارگذاری دوباره پایدار می‌ماند.
 *   ۶. سرویس‌ورکر PWA ثبت شده است (کارکرد آفلاین).
 *   ۷. تغییر رمز به رمز قوی موفق است و رمز قدیمی دیگر کار نمی‌کند.
 *
 * پیش‌نیاز: نسخهٔ اجرایی در حالت --server روی BASE در حال اجرا و «نصب تازه» باشد.
 * اجرا: E2E_DESKTOP_BASE=http://127.0.0.1:3311 node scripts/e2e-desktop.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const BASE = (process.env.E2E_DESKTOP_BASE ?? 'http://127.0.0.1:3311').replace(/\/+$/, '');
const USERNAME = process.env.E2E_DESKTOP_USER ?? '123456';
const PASSWORD = process.env.E2E_DESKTOP_PASS ?? '123456';
const NEW_PASSWORD = process.env.E2E_DESKTOP_NEW_PASS ?? 'Payesh2Strong';
const evidenceDir = path.join(root, 'docs/testing/evidence');
const reportPath = path.join(root, 'docs/testing/desktop-e2e.json');
const stamp = Date.now().toString(36);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 400) });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

let browser;
try {
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    env: { ...process.env, ...extraEnv },
  });
} catch (e) {
  // صادقانه: نبود کتابخانه‌های سیستمی مرورگر یعنی آزمون اجرا نشده است، نه اینکه رد شده باشد.
  const reason = e instanceof Error ? e.message.split('\n')[0] : String(e);
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        base: BASE,
        browser: executablePath,
        status: 'NOT RUN',
        reason: `مرورگر اجرا نشد: ${reason}`,
        hint: 'کتابخانه‌های سیستمی (libnss3 …) نصب نیستند؛ در CI نصب می‌شوند.',
      },
      null,
      2,
    ),
  );
  console.error(`NOT RUN — ${reason}`);
  process.exit(2);
}

async function newPage() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1360, height: 900 });
  page.on('pageerror', (e) => console.log(`pageerror: ${String(e.message).slice(0, 200)}`));
  return page;
}

const mainText = (page) =>
  page.evaluate(() => (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').trim());

async function login(page, password = PASSWORD) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 40_000 });
  await page.waitForSelector('input#username', { timeout: 25_000 });
  await page.type('input#username', USERNAME);
  await page.type('input#password', password);
  await Promise.all([
    page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 30_000 }),
    page.click('button[type=submit]'),
  ]);
  await page.waitForFunction(() => /داشبورد/.test(document.querySelector('main')?.innerText ?? ''), { timeout: 30_000 });
}

async function section(title, fn) {
  try {
    await fn();
  } catch (e) {
    record(`${title}: بدون خطای اجرایی`, false, e instanceof Error ? e.message : String(e));
    const pages = await browser.pages();
    const last = pages.at(-1);
    if (last) {
      await last.screenshot({ path: path.join(evidenceDir, `desktop-fail-${stamp}-${results.length}.png`) }).catch(() => {});
    }
  }
}

let page;

await section('بارگذاری صفحهٔ ورود', async () => {
  page = await newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 40_000 });
  const html = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    title: document.title,
    hasUsername: Boolean(document.querySelector('input#username')),
  }));
  record('صفحهٔ ورود با dir=rtl و زبان فارسی', html.dir === 'rtl' && html.lang.startsWith('fa'), `${html.dir}/${html.lang}`);
  record('فرم ورود در دسترس است', html.hasUsername, html.title);
  await page.screenshot({ path: path.join(evidenceDir, `desktop-login-${stamp}.png`) });
});

await section('ورود با اعتبارنامهٔ نخستین اجرا', async () => {
  await login(page);
  const text = await mainText(page);
  record('ورود با ۱۲۳۴۵۶/۱۲۳۴۵۶ موفق است', /داشبورد/.test(text), text.slice(0, 120));
  record('سامانه تغییر رمز را اجباری اعلام می‌کند', /تغییر رمز|رمز عبور/.test(await page.content()), 'بنر باید رمز تغییر کند');
  await page.screenshot({ path: path.join(evidenceDir, `desktop-dashboard-${stamp}.png`) });
});

await section('کوکی نشست', async () => {
  const cdp = await page.createCDPSession();
  const { cookies } = await cdp.send('Network.getAllCookies');
  const sid = cookies.find((c) => c.name === 'payesh2_sid');
  const visible = await page.evaluate(() => document.cookie);
  record('کوکی نشست httpOnly است', Boolean(sid?.httpOnly) && !visible.includes('payesh2_sid'), `httpOnly=${sid?.httpOnly}`);
  record('کوکی نشست Secure است و روی ۱۲۷٫۰٫۰۱ پذیرفته می‌شود', Boolean(sid) && sid.secure === true, `secure=${sid?.secure}`);
});

await section('پایداری نشست', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 40_000 });
  await page.waitForFunction(() => /داشبورد/.test(document.querySelector('main')?.innerText ?? ''), { timeout: 30_000 });
  record('پس از بارگذاری دوباره هنوز وارد است', true, 'نشست پایدار است');
});

await section('سرویس‌ورکر PWA', async () => {
  const state = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, active: false };
    const reg = await navigator.serviceWorker.getRegistration();
    return { supported: true, active: Boolean(reg?.active), scope: reg?.scope };
  });
  record('سرویس‌ورکر PWA فعال است (پوستهٔ برنامه آفلاین می‌ماند)', state.supported && state.active, JSON.stringify(state));
});

await section('تغییر رمز', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle2', timeout: 40_000 });
  await page.waitForSelector('input#cp', { timeout: 25_000 });
  await page.type('input#cp', PASSWORD);
  await page.type('input#np', '123456');
  await page.type('input#rp', '123456');
  const disabled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'ذخیره');
    return btn?.disabled ?? null;
  });
  record('رمز کوتاه در رابط کاربری پذیرفته نمی‌شود (دکمه غیرفعال)', disabled === true, `disabled=${disabled}`);

  await page.evaluate(() => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('cp', '');
    set('np', '');
    set('rp', '');
  });
  await page.type('input#cp', PASSWORD);
  await page.type('input#np', NEW_PASSWORD);
  await page.type('input#rp', NEW_PASSWORD);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'ذخیره');
    btn?.click();
  });
  await page.waitForFunction(() => /ذخیره شد|تغییر کرد|موفق/.test(document.body.innerText), { timeout: 30_000 });
  record('تغییر رمز به رمز قوی انجام شد', true, NEW_PASSWORD.replace(/./g, '*'));
});

await section('رمز قدیمی دیگر کار نمی‌کند', async () => {
  const fresh = await newPage();
  await fresh.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 40_000 });
  await fresh.waitForSelector('input#username', { timeout: 25_000 });
  await fresh.type('input#username', USERNAME);
  await fresh.type('input#password', PASSWORD);
  await Promise.all([fresh.waitForResponse((r) => r.url().includes('/api/auth/login')), fresh.click('button[type=submit]')]);
  await sleep(800);
  const stillLogin = await fresh.$('input#password');
  record('ورود با رمز قدیمی رد می‌شود', Boolean(stillLogin), 'فرم ورود باقی می‌ماند');
  await fresh.type('input#password', NEW_PASSWORD);
  await Promise.all([
    fresh.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 30_000 }),
    fresh.click('button[type=submit]'),
  ]);
  record('ورود با رمز جدید موفق است', true, '');
});

await browser.close();

const failed = results.filter((r) => r.status !== 'PASS');
const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  browser: executablePath,
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  passed: results.length - failed.length,
  total: results.length,
  results,
};
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${report.status} — ${report.passed}/${report.total} · ${path.relative(root, reportPath)}`);
process.exit(failed.length === 0 ? 0 : 1);
