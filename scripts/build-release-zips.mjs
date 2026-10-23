#!/usr/bin/env node
/**
 * بسته‌بندی دارایی‌های قابل دانلود:
 *   artifacts/payesh2-standalone-html.zip  ← HTML تک‌فایل + راهنمای فارسی
 *   artifacts/payesh2-win-x64.zip          ← payesh2.exe (+ همان راهنما)
 * EXE خام ۱۱۹MB است و از حد ۱۰۰MB هر فایل در گیت‌هاب بزرگ‌تر است، پس ZIP می‌شود.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, 'artifacts');
const work = path.join(artifacts, '.zip-work');
const guide = path.join(root, 'docs/deployment/standalone-howto.txt');
const desktopGuide = path.join(root, 'docs/deployment/windows-desktop-howto.txt');

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

const html = path.join(artifacts, 'payesh2-standalone.html');
const exe = path.join(artifacts, 'payesh2.exe');
/**
 * زمان فایل‌ها ثابت می‌شود تا خروجی ZIP بازتولیدپذیر باشد؛ وگرنه هر بار build هش متفاوت
 * می‌دهد و مقایسه‌ی هش منتشرشده با فایل دانلودی بی‌معنا می‌شود.
 */
const FIXED_TIME = new Date(Date.UTC(2026, 9, 23, 0, 0, 0));
const stage = async (from, to) => {
  await copyFile(from, to);
  await utimes(to, FIXED_TIME, FIXED_TIME);
};
await stage(html, path.join(work, 'payesh2-standalone.html'));
await stage(guide, path.join(work, 'راهنما.txt'));

const htmlZip = path.join(artifacts, 'payesh2-standalone-html.zip');
await rm(htmlZip, { force: true });
execFileSync('zip', ['-9', '-X', '-q', '-j', htmlZip, path.join(work, 'payesh2-standalone.html'), path.join(work, 'راهنما.txt')]);

let winZip = null;
try {
  await stat(exe);
  winZip = path.join(artifacts, 'payesh2-win-x64.zip');
  await rm(winZip, { force: true });
  await stage(desktopGuide, path.join(work, 'راهنمای نصب.txt'));
  // نام فایل داخل بسته با نام نصب‌شده یکی است تا کاربر همان چیزی را ببیند که نصب می‌شود
  const stagedExe = path.join(work, 'Payesh2.exe');
  await stage(exe, stagedExe);
  execFileSync('zip', ['-9', '-X', '-q', '-j', winZip, stagedExe, path.join(work, 'راهنمای نصب.txt')]);
} catch {
  console.warn('• هشدار: payesh2.exe نیست؛ ZIP ویندوز ساخته نشد (npm run artifact:exe)');
}

const sha = async (f) => createHash('sha256').update(await readFile(f)).digest('hex');
const out = {};
for (const [key, file] of [
  ['standaloneHtmlZip', htmlZip],
  ['standaloneHtml', html],
  ...(winZip ? [['winZip', winZip]] : []),
]) {
  const st = await stat(file);
  out[key] = { file: path.basename(file), bytes: st.size, sha256: await sha(file) };
}
await rm(work, { recursive: true, force: true });
await writeFile(path.join(artifacts, 'checksums.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
