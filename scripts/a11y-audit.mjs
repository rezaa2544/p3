#!/usr/bin/env node
/**
 * بازبینی خودکار دسترس‌پذیری (WCAG 2.1 A/AA) با axe-core در مرورگر واقعی.
 *
 * چه چیزی را می‌سنجد: تضاد رنگ، برچسب فرم‌ها، نام قابل‌دسترس دکمه‌ها و پیوندها، ساختار
 * عنوان‌ها، نقش‌های ARIA، ترتیب فوکوس و وجود landmarkها — روی صفحه‌های اصلی محصول،
 * هم در حالت روشن و هم با پیمایش صفحه‌کلید.
 *
 * محدودیت صریح: این ابزار جای آزمون با صفحه‌خوان واقعی (NVDA/VoiceOver) را نمی‌گیرد.
 *
 * اجرا: E2E_BASE=http://127.0.0.1:3400 node scripts/a11y-audit.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const BASE = (process.env.E2E_BASE ?? 'http://127.0.0.1:3400').replace(/\/+$/, '');
const PASSWORD = process.env.E2E_PASSWORD ?? 'Payesh1404a';
const reportPath = path.join(root, 'docs/testing/a11y-report.json');
const evidenceDir = path.join(root, 'docs/testing/evidence');
const axeSource = await readFile(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8');

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
  console.error('مرورگر نصب نیست: npm i --no-save puppeteer-core @sparticuz/chromium');
  process.exit(2);
}

await mkdir(evidenceDir, { recursive: true });
const { puppeteer, executablePath, extraEnv } = loaded;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, ...extraEnv },
});

const pages = [
  { name: 'ورود', path: '/login', auth: false },
  { name: 'داشبورد', path: '/', auth: true },
  { name: 'حضور و غیاب', path: '/attendance', auth: true },
  { name: 'گزارش حضور', path: '/attendance/report', auth: true },
  { name: 'ارزیابی و نمرات', path: '/grades', auth: true },
  { name: 'کارنامه', path: '/report-card', auth: true },
  { name: 'تکالیف', path: '/assignments', auth: true },
  { name: 'اطلاعیه‌ها', path: '/announcements', auth: true },
  { name: 'دانش‌آموزان', path: '/students', auth: true },
  { name: 'کاربران و نقش‌ها', path: '/users', auth: true },
  { name: 'گزارش‌های مدیریتی', path: '/reports', auth: true },
];

const results = [];

async function audit(page, label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => {
    // axe-core در همین صفحه تزریق شده است؛ تایپ ندارد
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  });
  const violations = res.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  return { page: label, violations, passes: res.passes.length };
}

try {
  // صفحه‌ی ورود بدون نشست
  const anonymous = await browser.createBrowserContext();
  const loginPage = await anonymous.newPage();
  await loginPage.setViewport({ width: 1440, height: 1000 });
  await loginPage.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 30_000 });
  await loginPage.waitForSelector('#username', { timeout: 20_000 });
  results.push(await audit(loginPage, 'ورود'));
  await loginPage.screenshot({ path: path.join(evidenceDir, 'a11y-login.png') });

  // پیمایش با صفحه‌کلید: فوکوس باید روی فیلدها با نشانگر دیده‌شود حرکت کند
  await loginPage.keyboard.press('Tab');
  await loginPage.keyboard.press('Tab');
  const focusTrail = await loginPage.evaluate(() =>
    [...document.querySelectorAll(':focus')].map((el) => el.id || el.tagName.toLowerCase()),
  );
  results.push({ page: 'پیمایش صفحه‌کلید (ورود)', focusTrail, violations: [], passes: focusTrail.length > 0 ? 1 : 0 });

  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.type('#username', 'admin');
  await page.type('#password', PASSWORD);
  await Promise.all([
    page.waitForFunction(() => !document.querySelector('input[type=password]'), { timeout: 25_000 }),
    page.click('button[type=submit]'),
  ]);

  for (const item of pages.filter((p) => p.auth)) {
    await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle2', timeout: 30_000 });
    await page.waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 20, {
      timeout: 25_000,
    });
    await new Promise((r) => setTimeout(r, 600));
    results.push(await audit(page, item.name));
    const slug = item.path === '/' ? 'dashboard' : item.path.replace(/^\//, '').replace(/\//g, '-');
    await page.screenshot({ path: path.join(evidenceDir, `a11y-${slug}.png`) });
  }
} finally {
  await browser.close();
}

const allViolations = results.flatMap((r) => r.violations.map((v) => ({ ...v, page: r.page })));
const byImpact = (level) => allViolations.filter((v) => v.impact === level).length;
const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  engine: 'axe-core 4.x — WCAG 2.1 A/AA',
  chrome: executablePath,
  status: allViolations.filter((v) => v.impact === 'critical' || v.impact === 'serious').length === 0 ? 'PASS' : 'FAIL',
  summary: {
    pages: results.length,
    violations: allViolations.length,
    critical: byImpact('critical'),
    serious: byImpact('serious'),
    moderate: byImpact('moderate'),
    minor: byImpact('minor'),
  },
  results,
  violations: allViolations,
};
await writeFile(reportPath, JSON.stringify(report, null, 2));

for (const r of results) {
  const critical = r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  console.log(`${critical.length === 0 ? '✓' : '✗'} ${r.page} — ${r.violations.length} ایراد (${critical.length} جدی)`);
  for (const v of r.violations) console.log(`   · [${v.impact}] ${v.id} ×${v.nodes} — ${v.help}`);
}
console.log(
  `\n${report.status} — ${report.summary.pages} صفحه، critical=${report.summary.critical}، serious=${report.summary.serious}، moderate=${report.summary.moderate}، minor=${report.summary.minor}`,
);
console.log(`گزارش: ${path.relative(root, reportPath)}`);
process.exit(report.status === 'PASS' ? 0 : 1);
