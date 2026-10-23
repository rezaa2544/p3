#!/usr/bin/env node
/**
 * ساخت نسخه‌ی اجرایی مستقل (بدون نیاز به نصب Node روی رایانه‌ی مقصد).
 *
 * روش: باندل کامل API + رابط کاربری + مهاجرت‌ها + فایل‌های PGlite به یک فایل ESM،
 * سپس بسته‌بندی آن به‌عنوان SEA (Single Executable Application) داخل نسخه‌ی رسمی Node.
 * در نخستین اجرا، بوت‌استرپ همه‌ی دارایی‌ها را در PAYESH2_HOME استخراج می‌کند و سرور را
 * در همان فرایند بالا می‌آورد (بدون پنجره‌ی کنسول اضافه، بدون نیاز به npm).
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
  const tgz = path.join(cache, `node-${platform}-${NODE_VERSION}.tgz`);
  execFileSync('npm', ['pack', `node-${platform}-x64@${NODE_VERSION}`, '--pack-destination', cache], {
    stdio: 'inherit',
  });
  const tar = path.join(cache, `node-${platform}-x64-${NODE_VERSION}.tgz`);
  if (!existsSync(tar) && existsSync(tgz)) await cp(tgz, tar);
  const extract = path.join(cache, `x-${platform}`);
  await mkdir(extract, { recursive: true });
  execFileSync('tar', ['-xzf', tar, '-C', extract, '--strip-components=1']);
  const bin = path.join(extract, platform === 'win' ? 'bin/node.exe' : 'bin/node');
  if (!existsSync(bin)) throw new Error(`باینری Node پیدا نشد: ${bin}`);
  if (platform === 'linux') execFileSync('chmod', ['+x', bin]);
  return bin;
}

const linuxNode = await nodeBinary('linux');

// ۲) باندل API به یک فایل ESM (همه‌ی وابستگی‌ها جز ماژول‌های بومی اختیاری)
console.log('• باندل سرور');
const serverEntry = path.join(root, 'apps/api/dist/server.js');
if (!existsSync(serverEntry)) throw new Error('apps/api/dist نیست؛ ابتدا npm run build');
const bundlePath = path.join(work, 'server.cjs');
sh('npx', [
  '--no-install',
  'esbuild',
  serverEntry,
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  '--outfile=' + bundlePath,
  '--log-level=error',
  '--external:pg-native',
  '--external:bufferutil',
  '--external:utf-8-validate',
]);

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

// ۳) دارایی‌ها
const assets = new Map();
assets.set('server.cjs', bundlePath);
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
let hasStandalone = false;
try {
  await stat(standalonePath);
  assets.set('payesh2-standalone.html', standalonePath);
  hasStandalone = true;
} catch {
  console.warn('• هشدار: artifacts/payesh2-standalone.html نیست؛ نسخه‌ی بسته‌بندی‌شده /standalone.html نخواهد داشت');
}
assets.set('BUILD_ID', null);
const buildIdPath = path.join(work, 'build-id.txt');
await writeFile(buildIdPath, buildId);
assets.set('BUILD_ID', buildIdPath);

// ۴) بوت‌استرپ
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
const home = process.env.PAYESH2_HOME || path.join(os.homedir(), '.payesh2');
const runtime = path.join(home, 'runtime', buildId);
const files = ${JSON.stringify([...assets.keys()].filter((n) => n !== 'BUILD_ID'))};

function ensureRuntime() {
  const marker = path.join(runtime, '.ready');
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(runtime, { recursive: true });
  for (const name of files) {
    const dest = path.join(runtime, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const buf = Buffer.from(sea.getAsset(name));
    const same = fs.existsSync(dest) && fs.statSync(dest).size === buf.length;
    if (!same) fs.writeFileSync(dest, buf);
  }
  fs.writeFileSync(marker, buildId);
}

function ensureSecret(dir) {
  const file = path.join(dir, 'session.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

ensureRuntime();
const dataDir = process.env.PGLITE_DIR || path.join(home, 'data');
fs.mkdirSync(dataDir, { recursive: true });

process.env.PAYESH2_BUILD = buildId;
process.env.PAYESH2_HOME = home;
process.env.WEB_DIST = path.join(runtime, 'web');
process.env.MIGRATIONS_DIR = path.join(runtime, 'migrations');
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(home, 'uploads');
process.env.PGLITE_DIR = dataDir;
process.env.PGLITE_WASM = path.join(runtime, 'pglite.wasm');
process.env.PGLITE_DATA = path.join(runtime, 'pglite.data');
${hasStandalone ? "process.env.STANDALONE_HTML = path.join(runtime, 'payesh2-standalone.html');" : ''}
process.env.SESSION_SECRET = process.env.SESSION_SECRET || ensureSecret(home);
process.env.PORT = process.env.PORT || '3000';
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:' + process.env.PORT;
process.env.PAYESH_FIRST_ADMIN = process.env.PAYESH_FIRST_ADMIN || '1';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'development';
process.chdir(home);

console.log('پایش ۲ — نسخه‌ی ' + buildId);
console.log('آدرس: http://localhost:' + process.env.PORT);
console.log('داده‌ها: ' + dataDir);

try {
  const { createRequire } = require('node:module');
  const load = createRequire(__filename);
  load(path.join(runtime, 'server.cjs'));
} catch (e) {
  console.error('خطا در راه‌اندازی:', e && e.message ? e.message : e);
  process.exit(1);
}
`,
);

// ۵) ساخت blob و تزریق
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

const size = (await stat(exePath)).size;
const sha = createHash('sha256').update(await readFile(exePath)).digest('hex');
const meta = {
  builtAt: new Date().toISOString(),
  buildId,
  target,
  nodeVersion: NODE_VERSION,
  file: exeName,
  bytes: size,
  sha256: sha,
  host: `${os.platform()}-${os.arch()}`,
};
await writeFile(path.join(outDir, `payesh2-${target}.json`), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta, null, 2));
