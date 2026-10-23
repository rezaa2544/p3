import path from 'node:path';
import { closePool } from '../db.js';
import { createBackup } from '../services/backup.js';
import { ensureDatabase, stopEmbeddedDatabase } from './env.js';

async function main() {
  await ensureDatabase();
  const out = process.argv[2] ?? path.join(process.cwd(), '.data', 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const manifest = await createBackup(out);
  console.log(
    JSON.stringify({
      ok: true,
      dir: out,
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((s, t) => s + t.rows, 0),
      createdAt: manifest.createdAt,
    }),
  );
  await closePool();
  await stopEmbeddedDatabase();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
});
