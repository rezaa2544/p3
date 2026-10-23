import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { PGlite } from '@electric-sql/pglite';
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
 * اگر DATABASE_URL تنظیم نشده باشد، یک سرور PostgreSQL واقعی (PGlite روی wire protocol)
 * برای محیط توسعه بالا می‌آید. کد برنامه همیشه با درایور pg صحبت می‌کند.
 */
export async function ensureDatabase(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const port = Number(process.env.PGLITE_PORT ?? 55432);
  const dataDir = process.env.PGLITE_DIR ?? path.join(root, '.pglite');
  const db = await PGlite.create({ dataDir });
  pgliteServer = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await pgliteServer.start();
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
