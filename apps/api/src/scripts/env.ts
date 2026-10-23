import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import { PGlite, type PGliteOptions } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = process.cwd();
for (const candidate of [path.join(root, '.env'), path.join(root, '../../.env')]) {
  if (existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

let pgliteServer: PGLiteSocketServer | null = null;

/**
 * در نسخه‌ی بسته‌بندی‌شده (EXE/SEA) فایل‌های wasm و data کنار برنامه استخراج می‌شوند و
 * مسیرشان با PGLITE_WASM / PGLITE_DATA داده می‌شود؛ چون در باندل تک‌فایلی مسیر
 * import.meta قابل اتکا نیست. اگر تنظیم نشده باشند، PGlite خودش فایل‌ها را پیدا می‌کند.
 */
export async function pgliteFileOptions(): Promise<PGliteOptions> {
  const opts: PGliteOptions = {};
  const wasmPath = process.env.PGLITE_WASM;
  const dataPath = process.env.PGLITE_DATA;
  if (wasmPath && existsSync(wasmPath)) {
    // WebAssembly در lib تایپ‌اسکریپت این پروژه تعریف نشده است؛ در Node یک شیء جهانی است.
    const wa = (globalThis as unknown as { WebAssembly: { compile(b: Buffer): Promise<never> } }).WebAssembly;
    opts.wasmModule = await wa.compile(await readFile(wasmPath));
  }
  if (dataPath && existsSync(dataPath)) {
    opts.fsBundle = new Blob([await readFile(dataPath)]);
  }
  return opts;
}

/**
 * اگر DATABASE_URL تنظیم نشده باشد، یک سرور PostgreSQL واقعی (PGlite روی wire protocol)
 * برای محیط توسعه بالا می‌آید. کد برنامه همیشه با درایور pg صحبت می‌کند.
 */
export async function ensureDatabase(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  let port = Number(process.env.PGLITE_PORT ?? 55432);
  const dataDir = process.env.PGLITE_DIR ?? path.join(root, '.pglite');
  const db = await PGlite.create({ dataDir, ...(await pgliteFileOptions()) });
  // اگر پورت اشغال باشد (مثلاً دو نمونه هم‌زمان)، پورت بعدی آزاد امتحان می‌شود.
  for (let attempt = 0; attempt < 20 && !pgliteServer; attempt++) {
    const candidate = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
    try {
      await candidate.start();
      pgliteServer = candidate;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
      port += 1;
    }
  }
  if (!pgliteServer) throw new Error(`هیچ پورت آزادی برای PostgreSQL تعبیه‌شده پیدا نشد (از ${process.env.PGLITE_PORT ?? 55432})`);
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_URL = url;
  process.env.PAYESH_EMBEDDED_DB = '1';
  console.log(JSON.stringify({ level: 'info', msg: 'PGlite server started', port, dataDir }));
  return url;
}

export async function stopEmbeddedDatabase(): Promise<void> {
  if (pgliteServer) {
    await pgliteServer.stop();
    pgliteServer = null;
  }
}
