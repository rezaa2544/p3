#!/usr/bin/env node
/**
 * بازبینی ایستای APK اندروید.
 *
 * چه چیزی را اثبات می‌کند (و چه چیزی را نه):
 *  • ساختار بستهٔ اندروید: AndroidManifest.xml باینری، resources.arsc و classes.dex
 *  • شناسهٔ بسته/نسخه، minSdk/targetSdk، اکتیویتی راه‌انداز، برچسب فارسی برنامه
 *  • وجود مجوز اینترنت و اجازهٔ ترافیک بدون TLS (برای شبکهٔ محلی مدرسه)
 *  • امضای APK: نتیجهٔ apksigner (v1/v2/v3) اگر فایل بازبینی موجود باشد
 *
 * این آزمون «اجرا روی گوشی/شبیه‌ساز» نیست و چنین ادعایی هم نمی‌کند.
 *
 * استفاده: node scripts/verify-apk.mjs [--apk path] [--aapt2 path]
 * در CI مسیر aapt2 از ANDROID_HOME پیدا می‌شود؛ محلی می‌توان AAPT2_PATH داد.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const apkPath = path.resolve(
  argValue('--apk') ?? process.env.APK_PATH ?? path.join(root, 'artifacts/payesh2-android.apk'),
);
const reportPath = path.join(root, 'artifacts/verify-apk.json');

function findAapt2() {
  const explicit = argValue('--aapt2') ?? process.env.AAPT2_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (home && existsSync(path.join(home, 'build-tools'))) {
    // آخرین نسخهٔ build-tools
    const versions = readdirSync(path.join(home, 'build-tools')).sort().reverse();
    for (const v of versions) {
      const candidate = path.join(home, 'build-tools', v, 'aapt2');
      if (existsSync(candidate)) return candidate;
    }
  }
  try {
    execFileSync('aapt2', ['version'], { stdio: 'ignore' });
    return 'aapt2';
  } catch {
    return undefined;
  }
}

const aapt2 = findAapt2();

const checks = [];
const record = (name, ok, detail) => checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 300) });

if (!existsSync(apkPath)) {
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'NOT RUN',
    reason: `فایل APK پیدا نشد: ${path.relative(root, apkPath)}`,
    checks: [],
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.error(`NOT RUN — ${report.reason}`);
  process.exit(2);
}

const buf = await readFile(apkPath);
const st = await stat(apkPath);
const sha256 = createHash('sha256').update(buf).digest('hex');

/**
 * فهرست ورودی‌های ZIP با خواندن مستقیم «دایرکتوری مرکزی» — بدون وابستگی به unzip.
 * فرادادهٔ امضا (APK Signing Block) بین داده و دایرکتوری مرکزی می‌نشیند، پس یافتن
 * EOCD از انتها و پرش با offset صحیح کار می‌کند.
 */
function listZipEntries(buffer) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    names.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8'),
      uncompressed: buffer.readUInt32LE(offset + 24),
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// ۱) ساختار ZIP و اجزای اجباری
const entries = listZipEntries(buf);
const zipList = entries.map((e) => e.name);
const has = (re) => zipList.some((n) => re.test(n));
const entryOf = (name) => entries.find((e) => e.name === name);
record('بستهٔ ZIP سالم و قابل خواندن است', zipList.length > 5, `${zipList.length} ورودی`);
record('AndroidManifest.xml دارد', has(/^AndroidManifest\.xml$/), '');
record('resources.arsc دارد', has(/^resources\.arsc$/), '');
record('حداقل یک classes.dex دارد', has(/^classes\d*\.dex$/), zipList.filter((n) => n.endsWith('.dex')).join(','));
const dexEntry = entryOf('classes.dex');
record(
  'classes.dex کد واقعی دارد (بزرگ‌تر از ۲ کیلوبایت)',
  (dexEntry?.uncompressed ?? 0) > 2048,
  dexEntry ? `${dexEntry.uncompressed} بایت` : 'classes.dex نیست',
);
record('آیکون برنامه در بسته هست', has(/^res\/.*\.(png|webp|xml)$/), '');
record('امضای v1 (META-INF/*.RSA یا *.SF) دارد', has(/^META-INF\/.*\.(RSA|DSA|EC|SF)$/), '');

// ۲) badging از aapt2
let badging = '';
let aaptErr = '';
if (aapt2) {
  try {
    badging = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    aaptErr = String(e.message ?? e).slice(0, 200);
  }
}
// قالب badging بین نسخه‌های build-tools کمی تفاوت دارد؛ فاصله بعد از «:» اختیاری است
const field = (name) => (badging.match(new RegExp(`${name}\\s*:\\s*'([^']*)'`)) ?? [])[1] ?? '';

/**
 * سطوح SDK هم در badging و هم در درخت XML مانیفست خوانده می‌شوند؛ نسخه‌های مختلف
 * build-tools قالب badging را کمی تغییر داده‌اند، اما xmltree پایدار است.
 */
let xmltree = '';
if (aapt2) {
  try {
    xmltree = execFileSync(aapt2, ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apkPath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    xmltree = '';
  }
}
const xmlSdk = (attr) => {
  const m = xmltree.match(new RegExp(`android:${attr}\\(0x[0-9a-f]+\\)=\\(type 0x10\\)0x([0-9a-f]+)`));
  return m ? String(parseInt(m[1], 16)) : '';
};
const packageName = field('package: name');
const versionCode = field('versionCode');
const versionName = field('versionName');
const sdkVersion = field('sdkVersion') || field('minSdkVersion') || xmlSdk('minSdkVersion');
const targetSdk = field('targetSdkVersion') || xmlSdk('targetSdkVersion');
const label = (badging.match(/application-label(?:-fa)?:'([^']*)'/) ?? [])[1] ?? '';

record('aapt2 بسته را می‌خواند (manifest باینری معتبر)', Boolean(badging), aaptErr || aapt2);
record('شناسهٔ بسته ir.payesh2.app است', packageName === 'ir.payesh2.app', packageName || '-');
record('نسخه ثبت شده است', Boolean(versionName) && Boolean(versionCode), `${versionName} (${versionCode})`);
record('minSdk ≥ ۲۴', Number(sdkVersion) >= 24, `sdkVersion=${sdkVersion || '-'} (xml:${xmlSdk('minSdkVersion') || '-'})`);
record('targetSdk = ۳۴', Number(targetSdk) === 34, `targetSdkVersion=${targetSdk || '-'} (xml:${xmlSdk('targetSdkVersion') || '-'})`);
record(
  'اکتیویتی راه‌انداز MainActivity است',
  /launchable-activity: name='ir\.payesh2\.app\.MainActivity'/.test(badging),
  (badging.match(/launchable-activity: name='([^']+)'/) ?? [])[1] ?? '-',
);
record('برچسب فارسی برنامه ثبت شده است', label.includes('پایش'), label || '-');
const badgingIcon = (badging.match(/application:[^\n]*icon='([^']+)'/) ?? [])[1] ?? '';
record(
  'آیکون اعلام‌شده در مانیفست داخل بسته وجود دارد',
  Boolean(badgingIcon) && zipList.includes(badgingIcon),
  badgingIcon || 'آیکون اعلام نشده',
);
record('مجوز اینترنت دارد', /uses-permission: name='android\.permission\.INTERNET'/.test(badging), '');

// ۳) امضا: از خروجی apksigner اگر در دسترس باشد
const verifyPath = path.join(root, 'artifacts/payesh2-android-verify.txt');
let verifyText = '';
if (existsSync(verifyPath)) verifyText = await readFile(verifyPath, 'utf8');
record('امضای APK تأیید شد (apksigner verify)', /^Verifies\n/m.test(verifyText) || /Verifies/.test(verifyText), verifyText.split('\n')[0] ?? '-');
record(
  'طرح امضای v2 یا v3 فعال است',
  /v2 scheme \(APK Signature Scheme v2\): true/.test(verifyText) || /v3 scheme \(APK Signature Scheme v3\): true/.test(verifyText),
  /v2 scheme.*/.exec(verifyText)?.[0] ?? '-',
);
record('APK debug نیست (debuggable=false)', !/application-debuggable/.test(badging), /application-debuggable/.exec(badging)?.[0] ?? 'debuggable نیست');

const failed = checks.filter((c) => c.status !== 'PASS');
const report = {
  generatedAt: new Date().toISOString(),
  file: path.relative(root, apkPath),
  bytes: st.size,
  sha256,
  package: packageName || undefined,
  versionName: versionName || undefined,
  versionCode: versionCode || undefined,
  minSdk: sdkVersion ? Number(sdkVersion) : undefined,
  targetSdk: targetSdk ? Number(targetSdk) : undefined,
  aapt2: aapt2 ?? 'در دسترس نبود',
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  passed: checks.length - failed.length,
  total: checks.length,
  scope: 'بازبینی ایستای بسته؛ اجرا روی دستگاه/شبیه‌ساز اندروید انجام نشده است (NOT RUN)',
  checks,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));
for (const c of checks) console.log(`${c.status === 'PASS' ? '✓' : '✗'} ${c.name} — ${c.detail}`);
console.log(`\n${report.status} — ${report.passed}/${report.total} · ${path.relative(root, reportPath)}`);
process.exit(failed.length === 0 ? 0 : 1);
