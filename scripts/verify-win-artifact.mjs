#!/usr/bin/env node
/**
 * بازبینی ایستا (static) فایل اجرایی ویندوز.
 *
 * این آزمون «اجرا روی ویندوز» نیست و چنین ادعایی نمی‌کند؛ فقط چیزهایی را که واقعاً
 * می‌توان از خود فایل ثابت کرد می‌سنجد:
 *  • هدر PE و معماری x86-64 (نه ARM، نه ۳۲ بیتی)
 *  • زیرسیستم GUI بودن → اجرای برنامه هیچ پنجرهٔ کنسولی باز نمی‌کند
 *  • وجود آیکون و اطلاعات نسخه در منابع PE
 *  • وجود دارایی‌های نصب/اجرا (پوستهٔ میزکار، HTML تک‌فایل، مهاجرت‌ها، رابط کاربری)
 *  • سلامت sha256 و حجم
 * خروجی: artifacts/payesh2-win-static.json
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readPeInfo } from './lib/pe.mjs';

const root = path.resolve(import.meta.dirname, '..');
const exePath = process.env.EXE_PATH ?? path.join(root, 'artifacts/payesh2.exe');
const outPath = path.join(root, 'artifacts/payesh2-win-static.json');

const buf = await readFile(exePath);
const checks = [];
const record = (name, ok, detail) => checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail });

record('فایل با امضای MZ شروع می‌شود (فایل اجرایی ویندوز)', buf[0] === 0x4d && buf[1] === 0x5a, `bytes ${buf[0]},${buf[1]}`);

const peOffset = buf.readUInt32LE(0x3c);
const signature = buf.subarray(peOffset, peOffset + 4).toString('latin1');
record('امضای PE\\0\\0 در محل e_lfanew', signature === 'PE\0\0', `offset ${peOffset}, signature ${JSON.stringify(signature)}`);

const info = readPeInfo(buf);
record('معماری x86-64 (IMAGE_FILE_MACHINE_AMD64)', info.machine === 0x8664, `machine=0x${info.machine.toString(16)}`);
record('قالب PE32+ (۶۴ بیتی)', info.pe32plus, 'magic=0x20b');
record(
  'زیرسیستم GUI است (بدون پنجرهٔ کنسول در اجرای عادی)',
  info.subsystemName === 'GUI',
  `subsystem=${info.subsystem} (${info.subsystemName})`,
);

// منابع PE: آیکون و اطلاعات نسخه
const ResEdit = await import('resedit');
const parsed = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(parsed);
const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
record('آیکون در منابع فایل جاسازی شده است', iconGroups.length > 0, `icon groups=${iconGroups.length}`);
const versionEntries = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
let productName = '';
let fileVersion = '';
if (versionEntries[0]) {
  const strings = versionEntries[0].getStringValues({ lang: 1033, codepage: 1200 });
  productName = String(strings.ProductName ?? '');
  const v = versionEntries[0].fixedInfo.fileVersionMS ?? 0;
  fileVersion = `${(v >>> 16) & 0xffff}.${v & 0xffff}`;
}
record('اطلاعات نسخه و نام محصول ثبت شده است', Boolean(productName), `«${productName}» v${fileVersion || '?'}`);

// دارایی‌های SEA
const markers = ['desktop.cjs', 'server.cjs', 'payesh2-standalone.html', 'pglite.wasm', 'migrations'];
for (const marker of markers) {
  record(`دارایی «${marker}» در باندل هست`, buf.includes(Buffer.from(marker)), marker);
}

const html = await readFile(path.join(root, 'artifacts/payesh2-standalone.html'));
const htmlProbe = Buffer.from(html.subarray(0, 2048)).subarray(0, 200);
record('محتوای HTML تک‌فایل در فایل اجرایی جاسازی شده است', buf.includes(htmlProbe), `probe ${htmlProbe.length} بایت`);

const st = await stat(exePath);
const sha256 = createHash('sha256').update(buf).digest('hex');
const failed = checks.filter((c) => c.status !== 'PASS');
const report = {
  generatedAt: new Date().toISOString(),
  file: path.relative(root, exePath),
  bytes: st.size,
  sha256,
  architecture: 'win32-x64',
  subsystem: info.subsystemName,
  consoleWindowOnLaunch: info.subsystemName !== 'GUI',
  iconEmbedded: iconGroups.length > 0,
  productName,
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  scope: 'بازبینی ایستای فایل؛ اجرا روی ویندوز واقعی انجام نشده است (NOT RUN)',
  checks,
};
await writeFile(outPath, JSON.stringify(report, null, 2));
for (const c of checks) console.log(`${c.status === 'PASS' ? '✓' : '✗'} ${c.name} — ${c.detail}`);
console.log(`\n${report.status} — ${checks.length - failed.length}/${checks.length} · ${path.relative(root, outPath)}`);
process.exit(failed.length === 0 ? 0 : 1);
