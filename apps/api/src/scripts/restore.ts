import path from 'node:path';
import { closePool } from '../db.js';
import { restoreIntoEmptyDatabase } from '../services/backup.js';
import { ensureDatabase, stopEmbeddedDatabase } from './env.js';

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('مسیر پوشه پشتیبان را بدهید: npm run db:restore -- <dir>');
  await ensureDatabase();
  const result = await restoreIntoEmptyDatabase(path.resolve(dir));
  console.log(JSON.stringify({ ok: true, ...result }));
  await closePool();
  await stopEmbeddedDatabase();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
});
