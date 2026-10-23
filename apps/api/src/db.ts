import { AsyncLocalStorage } from 'node:async_hooks';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';
import { sha256 } from './security/password.js';

export type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  one: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T | null>;
  tx: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
};

export type Scope = { schoolId: string; role: string; userId: string };
type Store = Scope & { client: pg.PoolClient };

let pool: pg.Pool | null = null;
const als = new AsyncLocalStorage<Store>();

export function getPool(): pg.Pool {
  if (!pool) {
    const cfg = config();
    if (!cfg.DATABASE_URL) throw new Error('DATABASE_URL تنظیم نشده است');
    // PGliteSocketServer یک اتصال فعال را پشتیبانی می‌کند؛ در حالت دیتابیس تعبیه‌شده pool تک‌اتصالی است.
    const max = process.env.PAYESH_EMBEDDED_DB === '1' ? 1 : cfg.DB_POOL_MAX;
    pool = new pg.Pool({
      connectionString: cfg.DATABASE_URL,
      max,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'payesh2-api',
    });
    pool.on('error', (err) => {
      // اتصال مرده نباید کل فرایند را از بین ببرد
      console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: err.message }));
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Query بدون scope مدرسه — فقط برای احراز هویت/سلامت/مهاجرت. استفاده باید صریح و قابل audit باشد. */
export async function globalQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(sql, params);
  return res.rows as T[];
}

export async function globalOne<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await globalQuery<T>(sql, params);
  return rows[0] ?? null;
}

function wrap(client: pg.PoolClient): Db {
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows as T[],
    one: async <T>(sql: string, params: unknown[] = []) => {
      const rows = (await client.query(sql, params)).rows as T[];
      return rows[0] ?? null;
    },
    tx: async <T>(fn: (db: Db) => Promise<T>) => {
      await client.query('savepoint sp');
      try {
        const out = await fn(wrap(client));
        await client.query('release savepoint sp');
        return out;
      } catch (e) {
        await client.query('rollback to savepoint sp');
        throw e;
      }
    },
  };
}

/**
 * اجرای یک واحد کار محدود به یک مدرسه. RLS از طریق set_config(..., is_local=true) فعال می‌شود
 * و همان اتصال تا پایان تراکنش استفاده می‌شود؛ بنابراین scope قابل فرار نیست.
 */
export async function schoolTx<T>(scope: Scope, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.school_id', $1, true)", [scope.schoolId]);
    await client.query("select set_config('app.user_role', $1, true)", [scope.role]);
    await client.query("select set_config('app.user_id', $1, true)", [scope.userId]);
    const out = await als.run({ ...scope, client }, () => fn(wrap(client)));
    await client.query('commit');
    return out;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Query محدود به scope جاری. خارج از schoolTx خطا می‌دهد. */
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const store = als.getStore();
  if (!store) throw new Error('query خارج از scope مدرسه مسدود است');
  return (await store.client.query(sql, params)).rows as T[];
}

export async function q1<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}

export function currentScope(): Scope | undefined {
  const s = als.getStore();
  return s ? { schoolId: s.schoolId, role: s.role, userId: s.userId } : undefined;
}

const MIGRATIONS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../migrations');
export const migrationsDir = process.env.MIGRATIONS_DIR ?? MIGRATIONS_DIR;

export async function migrate(log: (msg: string) => void = () => {}): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query(`create table if not exists schema_migrations (
      version text primary key, applied_at timestamptz not null default now(), checksum text not null)`);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const checksum = sha256(sql);
      const existing = await client.query('select checksum from schema_migrations where version = $1', [file]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`migration ${file} پس از اعمال تغییر کرده است (checksum mismatch)`);
        }
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(version, checksum) values ($1,$2)', [file, checksum]);
        await client.query('commit');
        applied.push(file);
        log(`applied ${file}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${file} شکست خورد: ${(e as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
