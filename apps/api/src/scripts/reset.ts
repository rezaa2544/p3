import { closePool, getPool, migrate } from '../db.js';
import { ensureDatabase, stopEmbeddedDatabase } from './env.js';

/** فقط برای توسعه — همه داده‌های اسکیمای public را پاک می‌کند. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('reset در محیط تولید مجاز نیست');
  await ensureDatabase();
  const pool = getPool();
  await pool.query('drop schema public cascade');
  await pool.query('create schema public');
  const applied = await migrate((m) => console.log(m));
  console.log(JSON.stringify({ ok: true, applied }));
  await closePool();
  await stopEmbeddedDatabase();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
});
