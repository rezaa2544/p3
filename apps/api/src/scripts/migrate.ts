import { closePool, migrate } from '../db.js';
import { ensureDatabase, stopEmbeddedDatabase } from './env.js';

async function main() {
  await ensureDatabase();
  const applied = await migrate((m) => console.log(m));
  console.log(JSON.stringify({ ok: true, applied, count: applied.length }));
  await closePool();
  await stopEmbeddedDatabase();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
});
