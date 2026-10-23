#!/usr/bin/env node
/**
 * ساخت artifact «HTML تک‌فایل» از خروجی `vite build --mode standalone`.
 *
 * نکات مهمی که با تجربه‌ی واقعی به دست آمده‌اند (نسخه‌ی اول در مرورگر واقعی خالی/بی‌فایده بود):
 *  ۱. CSS، JS و آیکون داخل خود HTML جاسازی می‌شوند؛ هیچ ارجاع بیرونی نمی‌ماند.
 *  ۲. باندل به‌صورت اسکریپت **کلاسیک** (IIFE) جاسازی می‌شود، نه `type="module"`؛ اسکریپت
 *     module در باز کردن با file:// در بعضی مرورگرها اجرا نمی‌شود و نتیجه صفحه‌ی سفید است.
 *  ۳. یک «نگهبان بوت» کلاسیک درج می‌شود: اگر برنامه تا ۶ ثانیه mount نشد، پیام فارسی با
 *     راهنمای رفع مشکل نشان داده می‌شود (هرگز صفحه‌ی سفید بی‌توضیح).
 *  ۴. سرور همین فایل را در آدرس `/standalone.html` سرو می‌کند (مسیر در `app.ts` و
 *     `STANDALONE_HTML`)؛ در آن حالت دسترسی به API و ورود کامل کار می‌کند.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'apps/web/dist-standalone');
const outPath = path.join(root, 'artifacts/payesh2-standalone.html');

const BOOT_GUARD_ID = 'payesh-boot-guard';

const html = await readFile(path.join(srcDir, 'index.html'), 'utf8');
const css = await readFile(path.join(srcDir, 'app.css'), 'utf8');
const js = await readFile(path.join(srcDir, 'app.js'), 'utf8');
const icon = await readFile(path.join(srcDir, 'icon.svg'), 'utf8');

// باندل باید IIFE باشد؛ در غیر این صورت جاسازی به‌عنوان اسکریپت کلاسیک خطا می‌دهد.
if (/\bexport\s*\{|^\s*import\s+[\w{*]/m.test(js)) {
  throw new Error('باندل standalone به‌صورت ESM ساخته شده است؛ باید format=iife باشد');
}

/** جلوگیری از بسته‌شدن زودهنگام تگ اسکریپت در HTML */
const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const iconData = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;

const bootGuard = `<div id="${BOOT_GUARD_ID}" hidden>
  <div style="max-width:680px;margin:48px auto;padding:24px;font-family:system-ui,Tahoma,sans-serif;line-height:2;border:1px solid #fecaca;border-radius:14px;background:#fef2f2;color:#7f1d1d;direction:rtl;text-align:right">
    <strong style="font-size:1.05rem">برنامه بالا نیامد</strong>
    <p>فایل‌های برنامه (JS) اجرا نشد. اگر فایل را با <code dir="ltr">file://</code> باز کرده‌اید، ابتدا سرور را اجرا کنید و بعد همین فایل را از <code dir="ltr">http://localhost:3000/standalone.html</code> باز کنید.</p>
    <p style="margin:0;font-size:.85rem;color:#991b1b">جزئیات خطا در کنسول مرورگر (F12) دیده می‌شود.</p>
  </div>
</div>
<script>
(function () {
  var shown = false;
  function fail(reason) {
    if (shown) return;
    shown = true;
    var guard = document.getElementById('${BOOT_GUARD_ID}');
    var rootEl = document.getElementById('root');
    if (!guard) return;
    if (rootEl && rootEl.children.length > 0) return;
    guard.hidden = false;
    if (reason) guard.setAttribute('data-reason', String(reason).slice(0, 200));
    if (rootEl && rootEl.parentNode) rootEl.parentNode.insertBefore(guard, rootEl);
  }
  window.addEventListener('error', function (e) { fail(e && e.message ? e.message : 'error'); });
  window.addEventListener('unhandledrejection', function (e) { fail(e && e.reason ? e.reason : 'rejection'); });
  setTimeout(function () { fail('timeout'); }, 6000);
})();
</script>`;

let out = html
  .replace(/<link rel="manifest"[^>]*>/, '')
  // اسکریپت کلاسیک در <head> بلافاصله اجرا می‌شود و #root هنوز ساخته نشده است؛
  // بنابراین باندل در انتهای <body> درج می‌شود (معادل defer).
  .replace(/<script type="module"[^>]*src="[^"]*"><\/script>/, '')
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${iconData}" type="image/svg+xml" />`)
  .replace(/<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/<div id="root"><\/div>/, () => `<div id="root"></div>\n${bootGuard}`)
  .replace(/<\/body>/, () => `<script>${escapeScript(js)}</script>\n</body>`);

if (!out.includes(BOOT_GUARD_ID)) throw new Error('نگهبان بوت درج نشد');
if (out.includes('src="/app.js"') || out.includes('href="/app.css"')) {
  throw new Error('جاسازی کامل نشد؛ ارجاع بیرونی باقی مانده است');
}
const externalRefs = [...out.matchAll(/(?:src|href)="(?!data:|#)([^"']+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('mailto:'));
if (externalRefs.length) {
  throw new Error(`ارجاع بیرونی باقی مانده است: ${externalRefs.slice(0, 5).join(', ')}`);
}
if (!/پایش ۲/.test(out)) throw new Error('متن فارسی برنامه در خروجی نیست');

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, out);

const bytes = Buffer.byteLength(out);
console.log(
  JSON.stringify(
    {
      file: path.relative(root, outPath),
      bytes,
      sha256: createHash('sha256').update(out).digest('hex'),
      externalRefs: externalRefs.length,
      classicScript: !out.includes('type="module"'),
      bootGuard: out.includes(BOOT_GUARD_ID),
    },
    null,
    2,
  ),
);
