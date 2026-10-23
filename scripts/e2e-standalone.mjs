#!/usr/bin/env node
/**
 * آزمون پایان‌به‌پایان نسخه‌ی HTML تک‌فایل با مرورگر واقعی (Chromium headless).
 *
 * چه چیزی را می‌سنجد:
 *  ۱. باز کردن فایل با file:// → باید «راهنمای نسخه تک‌فایل» نمایش داده شود، نه فرم ورودِ
 *     بی‌اثر و نه صفحه‌ی سفید.
 *  ۲. باز کردن همان فایل از خود سرور (`/standalone.html`) → ورود واقعی با کاربر نمونه،
 *     رندر داشبورد و یک صفحه‌ی داخلی (حضور و غیاب) بدون خطای کنسول.
 *
 * پیش‌نیاز: سرور پایش ۲ در حال اجرا با داده‌ی نمونه.
 *   PGLITE_DIR=/tmp/pglite-e2e PGLITE_PORT=55450 PORT=3100 LOG_LEVEL=warn node apps/api/dist/server.js
 * و مرورگر: یا CHROME_PATH بدهید، یا بسته‌ی @sparticuz/chromium نصب باشد
 *   npm i --no-save puppeteer-core @sparticuz/chromium
 *
 * استفاده:
 *   E2E_BASE=http://127.0.0.1:3100 E2E_USER=admin E2E_PASSWORD=Payesh1404a node scripts/e2e-standalone.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:3100').replace(/\/+$/, '');
const USER = process.env.E2E_USER ?? 'admin';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Payesh1404a';
const HTML_PATH = process.env.E2E_HTML ?? path.join(root, 'artifacts/payesh2-standalone.html');
const evidenceDir = path.join(root, 'docs/testing/evidence');
const reportPath = process.env.E2E_REPORT
  ? path.resolve(process.env.E2E_REPORT)
  : path.join(root, 'docs/testing/standalone-e2e.json');

const results = [];
function record(name, ok, detail) {
  results.push({ name, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
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
    console.error(
      'مرورگر در دسترس نیست: puppeteer-core نصب نیست. برای اجرا:\n' +
        '  npm i --no-save puppeteer-core @sparticuz/chromium   (یا CHROME_PATH=/path/to/chrome)',
    );
    return null;
  }
}

const loaded = await loadPuppeteer();
if (!loaded) {
  await writeFile(
    reportPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), status: 'NOT RUN', reason: 'مرورگر نصب نشد' }, null, 2),
  );
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

try {
  // ── ۱) حالت file://
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    await page.goto(`file://${HTML_PATH}`, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction(() => (document.getElementById('root')?.textContent ?? '').trim().length > 20, {
      timeout: 15_000,
    });
    const info = await page.evaluate(() => ({
      text: (document.getElementById('root')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      hasPasswordField: !!document.querySelector('input[type=password]'),
      hasGuide: !!document.getElementById('server'),
    }));
    await page.screenshot({ path: path.join(evidenceDir, 'standalone-file-protocol.png') });
    record(
      'file:// → راهنمای فارسی نمایش داده می‌شود (نه صفحه سفید)',
      info.hasGuide && !info.hasPasswordField,
      `نمونه متن: ${info.text.slice(0, 60)}…`,
    );
    record('file:// → خطای اجرایی JS وجود ندارد', errors.length === 0, errors.join(' | ') || 'بدون خطا');
    await page.close();
  }

  // ── ۲) همین فایل از خود سرور
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 200)));

    const res = await page.goto(`${BASE}/standalone.html`, { waitUntil: 'networkidle2', timeout: 30_000 });
    record('سرور فایل را با 200 سرو می‌کند', res?.status() === 200, `status=${res?.status()}`);

    await page.waitForSelector('input#username', { timeout: 15_000 });
    await page.type('input#username', USER);
    await page.type('input#password', PASSWORD);
    await page.screenshot({ path: path.join(evidenceDir, 'standalone-login.png') });
    await Promise.all([
      page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 20_000 }),
      page.click('button[type=submit]'),
    ]);
    // منتظر می‌مانیم محتوای اصلی (نه منوی کنار) بالا بیاید
    await page.waitForFunction(() => /داشبورد/.test(document.querySelector('main')?.innerText ?? ''), {
      timeout: 20_000,
    });
    await new Promise((r) => setTimeout(r, 400));

    const dash = await page.evaluate(() => ({
      headings: [...document.querySelectorAll('main h1, main h2')].map((h) => h.textContent?.trim()).slice(0, 4),
      hasNav: !!document.querySelector('nav'),
      text: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120),
    }));
    await page.screenshot({ path: path.join(evidenceDir, 'standalone-dashboard.png') });
    record('ورود واقعی با کاربر دمو موفق است', dash.hasNav, `عنوان‌ها: ${dash.headings.join(' / ')}`);
    record('داشبورد رندر می‌شود', dash.headings.includes('داشبورد'), dash.text.slice(0, 70));

    // یک صفحه‌ی داخلی هم باز می‌کنیم تا lazy-load و API داخلی آزموده شود
    await Promise.all([
      page.waitForFunction(() => location.pathname.startsWith('/attendance'), { timeout: 20_000 }),
      page.click('nav a[href="/attendance"]'),
    ]);
    await page.waitForFunction(() => /حضور و غیاب|ثبت حضور|کلاس/.test(document.querySelector('main')?.innerText ?? ''), {
      timeout: 20_000,
    });
    await new Promise((r) => setTimeout(r, 500));
    const att = await page.evaluate(() => ({
      path: location.pathname,
      text: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
    }));
    await page.screenshot({ path: path.join(evidenceDir, 'standalone-attendance.png') });
    record(
      'صفحه‌ی حضور و غیاب از داخل فایل باز می‌شود',
      att.path.startsWith('/attendance') && /حضور/.test(att.text),
      `${att.path} — ${att.text.slice(0, 60)}`,
    );

    const fatal = consoleErrors.filter((t) => !/401|Unauthorized|Failed to load resource/.test(t));
    record('خطای اجرایی در کنسول نیست', fatal.length === 0, fatal.slice(0, 3).join(' | ') || 'بدون خطا');
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.status === 'FAIL');
const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  html: path.relative(root, HTML_PATH),
  chrome: executablePath,
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  results,
};
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(`\n${report.status} — ${results.length - failed.length}/${results.length} بررسی موفق`);
console.log(`گزارش: ${path.relative(root, reportPath)}`);
process.exit(failed.length === 0 ? 0 : 1);
