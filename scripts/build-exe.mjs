#!/usr/bin/env node
/**
 * ساخت نسخه‌ی اجرایی مستقل (بدون نیاز به نصب Node روی رایانه‌ی مقصد).
 *
 * روش: باندل کامل API + رابط کاربری + مهاجرت‌ها + فایل‌های PGlite + پوستهٔ میزکار به
 * چند دارایی، سپس بسته‌بندی آن‌ها به‌عنوان SEA (Single Executable Application) داخل
 * نسخه‌ی رسمی Node.
 *
 * خروجی ویندوز یک برنامهٔ «دسکتاپی» است، نه ابزار خط فرمان:
 *  • زیرسیستم PE به GUI تغییر می‌کند → هیچ پنجرهٔ CMD باز نمی‌شود.
 *  • آیکون و اطلاعات نسخه در منابع PE جاسازی می‌شوند.
 *  • همان فایل هم نصب‌کننده است (`--install`)، هم برنامه (اجرای عادی) و هم حذف‌کننده
 *    (`--uninstall`).
 *
 * استفاده:
 *   node scripts/build-exe.mjs --target linux-x64   # برای راستی‌آزمایی روی همین سندباکس
 *   node scripts/build-exe.mjs --target win-x64     # خروجی ویندوز (روی لینوکس ساخته می‌شود)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { desktopify, readPeInfo } from './lib/pe.mjs';

const NODE_VERSION = '26.12.1';
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const target = (args[args.indexOf('--target') + 1] ?? 'win-x64').trim();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const buildId = createHash('sha256')
  .update(`${pkg.version}:${target}:${Date.now()}`)
  .digest('hex')
  .slice(0, 12);

const work = path.join(root, 'artifacts/.build', `${target}`);
const outDir = path.join(root, 'artifacts');
await mkdir(work, { recursive: true });
await mkdir(outDir, { recursive: true });

function sh(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
}

async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else out.push({ rel, full });
  }
  return out;
}

// ۱) باینری رسمی Node برای تولید blob و برای اجرای SEA
const cache = path.join(root, 'artifacts/.cache');
await mkdir(cache, { recursive: true });

async function nodeBinary(platform) {
  const local = path.join(cache, `node-${platform}`);
  if (existsSync(local)) return local;
  console.log(`↓ دریافت Node ${NODE_VERSION} برای ${platform} از npm registry`);
  execFileSync('npm', ['pack', `node-${platform}-x64@${NODE_VERSION}`, '--pack-destination', cache], {
    stdio: 'inherit',
  });
  const tar = path.join(cache, `node-${platform}-x64-${NODE_VERSION}.tgz`);
  const extract = path.join(cache, `x-${platform}`);
  await mkdir(extract, { recursive: true });
  execFileSync('tar', ['-xzf', tar, '-C', extract, '--strip-components=1']);
  const bin = path.join(extract, platform === 'win' ? 'bin/node.exe' : 'bin/node');
  if (!existsSync(bin)) throw new Error(`باینری Node پیدا نشد: ${bin}`);
  if (platform === 'linux') execFileSync('chmod', ['+x', bin]);
  return bin;
}

const linuxNode = await nodeBinary('linux');

// ۲) باندل API به یک فایل CJS (همه‌ی وابستگی‌ها جز ماژول‌های بومی اختیاری)
function bundle(entry, outfile, label) {
  if (!existsSync(entry)) throw new Error(`${entry} نیست؛ ابتدا npm run build`);
  console.log(`• باندل ${label}`);
  sh('npx', [
    '--no-install',
    'esbuild',
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    '--outfile=' + outfile,
    '--log-level=error',
    '--external:pg-native',
    '--external:bufferutil',
    '--external:utf-8-validate',
  ]);
}

const bundlePath = path.join(work, 'server.cjs');
bundle(path.join(root, 'apps/api/dist/server.js'), bundlePath, 'سرور');

/**
 * esbuild در خروجی CJS، `import.meta` را با یک شیء خالی جایگزین می‌کند و PGlite
 * برای یافتن فایل‌های wasm/data به `import.meta.url` تکیه دارد. اینجا آن را با
 * آدرس واقعی فایل باندل پر می‌کنیم (مسیرها با متغیرهای محیطی هم صریح داده می‌شوند).
 */
const rawBundle = await readFile(bundlePath, 'utf8');
const patched = rawBundle
  .replace(/import_meta(\d*) = \{\}/g, 'import_meta$1 = { url: __payeshSelfUrl }')
  .replace(
    /^"use strict";/,
    '"use strict";\nvar __payeshSelfUrl = require("node:url").pathToFileURL(__filename).href;',
  );
if (!patched.includes('__payeshSelfUrl')) throw new Error('patch import.meta ناموفق بود');
await writeFile(bundlePath, patched);

// ۳) پوستهٔ میزکار (نصب/اجرا/حذف) — از همان کد تایپ‌اسکریپتِ آزمون‌شده
const desktopPath = path.join(work, 'desktop.cjs');
bundle(path.join(root, 'apps/api/src/desktop/cli.ts'), desktopPath, 'پوستهٔ میزکار');
if (!(await readFile(desktopPath, 'utf8')).includes('runDesktop')) {
  throw new Error('باندل پوستهٔ میزکار ناقص است');
}

// ۴) دارایی‌ها
const assets = new Map();
assets.set('server.cjs', bundlePath);
assets.set('desktop.cjs', desktopPath);
assets.set('pglite.wasm', path.join(root, 'node_modules/@electric-sql/pglite/dist/pglite.wasm'));
assets.set('pglite.data', path.join(root, 'node_modules/@electric-sql/pglite/dist/pglite.data'));
for (const f of await walk(path.join(root, 'apps/api/migrations'))) {
  assets.set(`migrations/${f.rel}`, f.full);
}
for (const f of await walk(path.join(root, 'apps/web/dist'))) {
  assets.set(`web/${f.rel}`, f.full);
}
// نسخه HTML تک‌فایل (اختیاری) تا سرور بسته‌بندی‌شده هم /standalone.html داشته باشد
const standalonePath = path.join(root, 'artifacts/payesh2-standalone.html');
try {
  await stat(standalonePath);
  assets.set('payesh2-standalone.html', standalonePath);
} catch {
  console.warn('• هشدار: artifacts/payesh2-standalone.html نیست؛ نسخه‌ی بسته‌بندی‌شده /standalone.html نخواهد داشت');
}
const buildIdPath = path.join(work, 'build-id.txt');
await writeFile(buildIdPath, buildId);
assets.set('BUILD_ID', buildIdPath);
const versionPath = path.join(work, 'version.txt');
await writeFile(versionPath, pkg.version);
assets.set('VERSION', versionPath);

// ۵) بوت‌استرپ
const payloadNames = [...assets.keys()].filter((n) => n !== 'BUILD_ID' && n !== 'VERSION' && n !== 'desktop.cjs');
const mainPath = path.join(work, 'main.cjs');
await writeFile(
  mainPath,
  `'use strict';
const sea = require('node:sea');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

if (!sea.isSea()) {
  console.error('این فایل باید نسخه‌ی بسته‌بندی‌شده باشد.');
  process.exit(1);
}

const buildId = sea.getAsset('BUILD_ID', 'utf8').trim();
const version = sea.getAsset('VERSION', 'utf8').trim();
const argv = process.argv.slice(1);
// در حالت نصب/حذف/برنامه پنجره‌ای وجود ندارد؛ در --server و --plan کنسول لازم است.
const gui = !['--server', '--headless', '--plan', '--dry-run'].some((f) => argv.includes(f));

const home = process.env.PAYESH2_HOME || (process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Payesh2')
  : (process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, 'payesh2') : path.join(os.homedir(), '.payesh2')));
const logDir = path.join(home, 'logs');
const logFile = path.join(logDir, 'app.log');
const payload = ${JSON.stringify(payloadNames)};

try { fs.mkdirSync(logDir, { recursive: true }); } catch {}

function log(line) {
  const text = '[' + new Date().toISOString() + '] ' + line + '\\n';
  try { fs.appendFileSync(logFile, text); } catch {}
  if (!gui) { try { process.stdout.write(text); } catch {} }
}

if (gui) {
  // بدون کنسول: نوشتن روی دستگیره‌های استاندارد نامعتبر خطا می‌دهد؛ خروجی به فایل می‌رود.
  const sink = (chunk) => {
    try { fs.appendFileSync(logFile, Buffer.isBuffer(chunk) ? chunk : String(chunk)); } catch {}
    return true;
  };
  process.stdout.write = sink;
  process.stderr.write = sink;
  const writeSync = fs.writeSync;
  fs.writeSync = function (fd) {
    try { return writeSync.apply(fs, arguments); } catch (e) {
      if (fd === 1 || fd === 2) return 0;
      throw e;
    }
  };
}

const runtime = path.join(home, 'runtime', buildId);
const bootDir = path.join(home, 'runtime', '.boot-' + buildId);

function writeAsset(name, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(sea.getAsset(name));
  if (!(fs.existsSync(dest) && fs.statSync(dest).size === buf.length)) fs.writeFileSync(dest, buf);
}

function ensureBoot() {
  const dest = path.join(bootDir, 'desktop.cjs');
  writeAsset('desktop.cjs', dest);
  return dest;
}

function ensureRuntime() {
  const marker = path.join(runtime, '.ready');
  if (fs.existsSync(marker)) return runtime;
  fs.mkdirSync(runtime, { recursive: true });
  for (const name of payload) writeAsset(name, path.join(runtime, name));
  fs.writeFileSync(marker, buildId);
  return runtime;
}

function ensureSecret(dir) {
  const file = path.join(dir, 'session.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function startServer(dir) {
  process.env.WEB_DIST = path.join(dir, 'web');
  process.env.MIGRATIONS_DIR = path.join(dir, 'migrations');
  process.env.PGLITE_WASM = path.join(dir, 'pglite.wasm');
  process.env.PGLITE_DATA = path.join(dir, 'pglite.data');
  const standalone = path.join(dir, 'payesh2-standalone.html');
  if (fs.existsSync(standalone)) process.env.STANDALONE_HTML = standalone;
  try { process.chdir(home); } catch {}
  const { createRequire } = require('node:module');
  const load = createRequire(path.join(dir, 'server.cjs'));
  load(path.join(dir, 'server.cjs'));
}

process.env.PAYESH2_HOME = home;
process.env.PAYESH2_BUILD = buildId;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || ensureSecret(home);

log('پایش ۲ — نسخه‌ی ' + version + ' (' + buildId + ')');
// در SEA، require تنها ماژول‌های داخلی را می‌شناسد؛ برای بارگذاری فایل از createRequire
const loadModule = require('node:module').createRequire(process.execPath);
try {
  const desktop = loadModule(ensureBoot());
  Promise.resolve(
    desktop.runDesktop({
      argv,
      execPath: process.execPath,
      buildId,
      version,
      gui,
      env: process.env,
      ensureRuntime,
      startServer,
      log,
      exit: (code) => process.exit(code),
    }),
  ).catch((e) => {
    log('fatal: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
} catch (e) {
  log('خطا در راه‌اندازی: ' + (e && e.message ? e.message : e));
  process.exit(1);
}
`,
);

// ۶) ساخت blob و تزریق
const seaConfig = {
  main: mainPath,
  output: path.join(work, 'sea.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: Object.fromEntries(assets),
};
const seaConfigPath = path.join(work, 'sea-config.json');
await writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2));
console.log('• ساخت SEA blob');
execFileSync(linuxNode, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit' });

const platformKey = target.startsWith('win') ? 'win' : 'linux';
const baseNode = await nodeBinary(platformKey);
const exeName = platformKey === 'win' ? 'payesh2.exe' : 'payesh2';
const exePath = path.join(outDir, exeName);
await rm(exePath, { force: true });
await cp(baseNode, exePath);
if (platformKey === 'linux') execFileSync('chmod', ['+x', exePath]);
console.log('• تزریق blob در باینری');
execFileSync(
  'npx',
  ['--no-install', 'postject', exePath, 'NODE_SEA_BLOB', path.join(work, 'sea.blob'), '--sentinel-fuse', FUSE],
  { stdio: 'inherit' },
);

/**
 * ویندوز: منابع PE (آیکون/نسخه) و زیرسیستم GUI تا هیچ پنجرهٔ کنسولی باز نشود.
 * ترتیب مهم است: اول منابع (چون resedit فایل را بازنویسی می‌کند) و بعد تغییر زیرسیستم.
 */
let peInfo = null;
let iconEmbedded = false;
if (platformKey === 'win') {
  const iconPath = path.join(outDir, 'payesh2.ico');
  iconEmbedded = existsSync(iconPath);
  if (!iconEmbedded) console.warn('• هشدار: artifacts/payesh2.ico نیست؛ فایل بدون آیکون ساخته می‌شود');
  console.log('• تنظیم زیرسیستم GUI و منابع ویندوز');
  const original = await readFile(exePath);
  const desktopBuf = await desktopify(original, {
    iconPath: iconEmbedded ? iconPath : undefined,
    version: pkg.version,
    productName: 'پایش ۲ — Payesh 2',
    description: 'سامانهٔ مدیریت مدرسه پایش ۲',
    company: 'پایش ۲',
    exeName: 'Payesh2.exe',
  });
  await writeFile(exePath, desktopBuf);
  peInfo = readPeInfo(desktopBuf);
  if (peInfo.subsystemName !== 'GUI') throw new Error('تنظیم زیرسیستم GUI ناموفق بود');
  // بلاب SEA باید پس از بازنویسی منابع هم سر جایش باشد
  const check = await readFile(exePath);
  if (check.length < desktopBuf.length - 1024) throw new Error('فایل پس از جاسازی منابع کوچک‌تر شد');
}

const size = (await stat(exePath)).size;
const sha = createHash('sha256').update(await readFile(exePath)).digest('hex');
const meta = {
  builtAt: new Date().toISOString(),
  buildId,
  version: pkg.version,
  target,
  nodeVersion: NODE_VERSION,
  file: exeName,
  bytes: size,
  sha256: sha,
  host: `${os.platform()}-${os.arch()}`,
  subsystem: peInfo?.subsystemName ?? 'CUI',
  consoleWindow: peInfo ? peInfo.subsystemName === 'CUI' : true,
  iconEmbedded,
  modes: ['install', 'app', 'uninstall', 'server', 'plan'],
};
await writeFile(path.join(outDir, `payesh2-${target}.json`), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
