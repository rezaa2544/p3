#!/usr/bin/env node
/**
 * فرادادهٔ APK برای انتشار و بررسی: حجم، sha256، شناسهٔ بسته، امضا و نشانی اجرای CI.
 *
 * در CI بعد از امضا اجرا می‌شود و `artifacts/payesh2-android.json` را می‌سازد تا همان
 * فایل کنار APK در مخزن ثبت شود و کاربر بتواند هش دانلودی خود را مقایسه کند.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const apk = path.join(root, 'artifacts/payesh2-android.apk');
const out = path.join(root, 'artifacts/payesh2-android.json');
const verifyJson = path.join(root, 'artifacts/verify-apk.json');
const verifyTxt = path.join(root, 'artifacts/payesh2-android-verify.txt');

if (!existsSync(apk)) {
  console.error('APK پیدا نشد؛ ابتدا ساخت و امضا انجام شود.');
  process.exit(1);
}

const buf = await readFile(apk);
const st = await stat(apk);
const verify = existsSync(verifyJson) ? JSON.parse(await readFile(verifyJson, 'utf8')) : null;
const signerText = existsSync(verifyTxt) ? await readFile(verifyTxt, 'utf8') : '';
const certSha = (signerText.match(/Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/) ?? [])[1];
const certDn = (signerText.match(/Signer #1 certificate DN: (.+)/) ?? [])[1]?.trim();
const schemes = ['v1', 'v2', 'v3', 'v3.1']
  .map((s) => {
    const m = signerText.match(new RegExp(`${s.replace('.', '\\.')} scheme[^:]*: (true|false)`));
    return m ? `${s}=${m[1]}` : null;
  })
  .filter(Boolean);

const runUrl =
  process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;

const meta = {
  builtAt: new Date().toISOString(),
  file: 'payesh2-android.apk',
  bytes: st.size,
  sha256: createHash('sha256').update(buf).digest('hex'),
  package: verify?.package,
  versionName: verify?.versionName,
  versionCode: verify?.versionCode,
  minSdk: verify?.minSdk,
  targetSdk: verify?.targetSdk,
  signature: {
    certificateSha256: certSha,
    certificateDn: certDn,
    schemes,
    note: 'کلید «پایلوت» در همان اجرای CI ساخته و فقط برای امضای همین بسته استفاده می‌شود؛ کلید انتشار در مخزن نگه‌داری نمی‌شود.',
  },
  staticVerification: verify ? { status: verify.status, passed: verify.passed, total: verify.total } : { status: 'NOT RUN' },
  deviceTest: 'NOT RUN — اجرا روی دستگاه/شبیه‌ساز اندروید انجام نشده است',
  scope: 'APK ساخته‌شده با AGP/Gradle و امضاشده با apksigner؛ بازبینی ایستا فقط ساختار/شناسه/امضا را ثابت می‌کند.',
  ciRun: runUrl,
  buildTools: process.env.BUILD_TOOLS_VERSION ?? '34.0.0',
  jdk: process.env.JAVA_VERSION ?? '17',
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
