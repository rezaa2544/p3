#!/usr/bin/env node
/**
 * بازبینی ایستا (static) فایل اجرایی ویندوز.
 *
 * این آزمون «اجرا روی ویندوز» نیست و چنین ادعایی نمی‌کند؛ فقط چیزهایی را که واقعاً
 * می‌توان از خود فایل ثابت کرد می‌سنجد:
 *  • هدر PE و معماری x86-64 (نه ARM، نه ۳۲ بیتی)
 *  • نوع فایل اجرایی (GUI/CUI) و زيرسیستم ویندوز
 *  • وجود باندل «HTML تک‌فایل» و فایل راهنما در داخل بسته (SEA assets)
 *  • سلامت sha256 و حجم
 * خروجی: artifacts/payesh2-win-static.json
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

const machine = buf.readUInt16LE(peOffset + 4);
record('معماری x86-64 (IMAGE_FILE_MACHINE_AMD64)', machine === 0x8664, `machine=0x${machine.toString(16)}`);

const optionalMagic = buf.readUInt16LE(peOffset + 24);
const pe32plus = optionalMagic === 0x20b;
record('قالب PE32+ (۶۴ بیتی)', pe32plus, `magic=0x${optionalMagic.toString(16)}`);

const subsystem = buf.readUInt16LE(peOffset + 24 + 68);
// 2 = GUI (بدون پنجره‌ی کنسول)، 3 = CUI (کنسول). هر دو پذیرفتنی‌اند؛ تنها ثبت می‌شود.
record('زیرسیستم ویندوز معتبر است', subsystem === 2 || subsystem === 3, subsystem === 3 ? 'CUI (کنسول)' : 'GUI');

const html = await readFile(path.join(root, 'artifacts/payesh2-standalone.html'));
const marker = Buffer.from('payesh2-standalone.html');
record('نام دارایی HTML تک‌فایل داخل باندل هست', buf.includes(marker), `«${marker.toString()}»`);

// اثر محتوایی: امضای HTML فارسی تولیدی باید داخل فایل باشد (SEA assets فشرده نیستند)
const htmlProbe = Buffer.from(html.subarray(0, 2048)).subarray(0, 200);
const embeddedHtml = buf.includes(htmlProbe);
record('محتوای HTML تک‌فایل در فایل اجرایی جاسازی شده است', embeddedHtml, `probe ${htmlProbe.length} بایت`);

/**
 * راهنمای فارسی داخل خود exe نیست؛ در همان ZIP کنارش قرار می‌گیرد (توسط
 * scripts/build-release-zips.mjs) و وجود آن با `unzip -l` بررسی می‌شود.
 */

const st = await stat(exePath);
const sha256 = createHash('sha256').update(buf).digest('hex');
const failed = checks.filter((c) => c.status !== 'PASS');
const report = {
  generatedAt: new Date().toISOString(),
  file: path.relative(root, exePath),
  bytes: st.size,
  sha256,
  architecture: 'win32-x64',
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  scope: 'بازبینی ایستای فایل؛ اجرا روی ویندوز واقعی انجام نشده است (NOT RUN)',
  checks,
};
await writeFile(outPath, JSON.stringify(report, null, 2));
for (const c of checks) console.log(`${c.status === 'PASS' ? '✓' : '✗'} ${c.name} — ${c.detail}`);
console.log(`\n${report.status} — ${checks.length - failed.length}/${checks.length} · ${path.relative(root, outPath)}`);
process.exit(failed.length === 0 ? 0 : 1);
