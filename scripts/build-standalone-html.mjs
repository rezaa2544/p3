#!/usr/bin/env node
/**
 * ساخت artifact «HTML تک‌فایل» از خروجی vite --mode standalone.
 * CSS، JS و آیکون داخل خود HTML جاسازی می‌شوند؛ فایل نهایی به هیچ فایل کنار خود
 * نیاز ندارد. توجه: این فایل برای فراخوانی API به همان مبدأ (same-origin) نیاز دارد؛
 * یعنی یا از خود سرور پایش ۲ باز شود، یا میزبان استاتیک آن /api را به سرور پروکسی کند.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const srcDir = path.join(root, 'apps/web/dist-standalone');
const outPath = path.join(root, 'artifacts/payesh2-standalone.html');

const html = await readFile(path.join(srcDir, 'index.html'), 'utf8');
const css = await readFile(path.join(srcDir, 'app.css'), 'utf8');
const js = await readFile(path.join(srcDir, 'app.js'), 'utf8');
const icon = await readFile(path.join(srcDir, 'icon.svg'), 'utf8');

const safeJs = js.replace(/<\/script/gi, '<\\/script');
const iconData = `data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}`;

let out = html
  .replace(/<link rel="manifest"[^>]*>/, '')
  .replace(/<script type="module"[^>]*src="[^"]*"><\/script>/, () => `<script type="module">${safeJs}</script>`)
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${iconData}" type="image/svg+xml" />`)
  .replace(/<link rel="apple-touch-icon"[^>]*>/, '');

if (out.includes('src="/assets') || out.includes('href="/assets')) {
  throw new Error('جاسازی کامل نشد؛ ارجاع بیرونی باقی مانده است');
}

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, out);
const bytes = Buffer.byteLength(out);
console.log(
  JSON.stringify(
    {
      file: path.relative(root, outPath),
      bytes,
      sha256: createHash('sha256').update(out).digest('hex'),
      externalRefs: (out.match(/(src|href)="\/[^"]*"/g) ?? []).length,
    },
    null,
    2,
  ),
);
