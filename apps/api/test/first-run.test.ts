import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, globalQuery, migrate } from '../src/db.js';
import { resetConfigCache } from '../src/config.js';
import { ensureFirstSetup } from '../src/services/first-run.js';
import { verifyPassword } from '../src/security/password.js';

const port = 23000 + (process.pid % 1000);
let db: PGlite;
let server: PGLiteSocketServer;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'payesh-first-run-'));
  db = await PGlite.create({ dataDir: dir });
  server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.SESSION_SECRET = 'first-run-secret-0123456789-abcdefghij';
  process.env.DB_POOL_MAX = '1';
  process.env.PAYESH_EMBEDDED_DB = '1';
  process.env.LOG_LEVEL = 'silent';
  resetConfigCache();
  await migrate();
});

afterAll(async () => {
  await closePool();
  await server.stop();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('نخستین اجرا: مدیر و مدرسه با رمز بدون پیش‌فرض عمومی', () => {
  it('رمز کوتاه رد می‌شود و کاربری ساخته نمی‌شود', async () => {
    const out = await ensureFirstSetup({ ADMIN_USERNAME: 'root', ADMIN_PASSWORD: 'short' } as NodeJS.ProcessEnv);
    expect(out.created).toBe(false);
    const count = await globalQuery<{ n: number }>('select count(*)::int as n from users');
    expect(count[0]!.n).toBe(0);
  });

  it('رمز تصادفی تولید می‌شود، یک‌بار برگردانده می‌شود و باید تغییر کند', async () => {
    const out = await ensureFirstSetup({ ADMIN_USERNAME: 'root' } as NodeJS.ProcessEnv);
    expect(out.created).toBe(true);
    expect(out.username).toBe('root');
    expect(out.temporaryPassword!.length).toBeGreaterThanOrEqual(16);

    const row = await globalQuery<{ password_hash: string; must_change_password: boolean; is_super_admin: boolean }>(
      'select password_hash, must_change_password, is_super_admin from users where username = $1',
      ['root'],
    );
    expect(row).toHaveLength(1);
    expect(row[0]!.must_change_password).toBe(true);
    expect(row[0]!.is_super_admin).toBe(true);
    expect(await verifyPassword(out.temporaryPassword!, row[0]!.password_hash)).toBe(true);

    // مدرسه، عضویت، سال تحصیلی و ترم اول باید ساخته شوند تا سامانه قابل استفاده باشد
    expect(out.schoolId).toBeTruthy();
    const school = await globalQuery<{ name: string; org_id: string }>('select name, org_id from schools where id = $1', [
      out.schoolId,
    ]);
    expect(school[0]!.name).toBe('مدرسه من');
    const userRow = await globalQuery<{ id: string }>('select id from users where username = $1', ['root']);
    const member = await globalQuery<{ role: string }>(
      'select role from memberships where user_id = $1 and school_id = $2',
      [userRow[0]!.id, out.schoolId],
    );
    expect(member[0]!.role).toBe('school_admin');
    const year = await globalQuery<{ is_current: boolean }>('select is_current from academic_years where id = $1', [
      out.academicYearId,
    ]);
    expect(year[0]!.is_current).toBe(true);
    const term = await globalQuery<{ seq: number }>('select seq from terms where id = $1', [out.termId]);
    expect(term[0]!.seq).toBe(1);
  });

  it('بار دوم کاربر جدید نمی‌سازد', async () => {
    const out = await ensureFirstSetup({ ADMIN_USERNAME: 'root' } as NodeJS.ProcessEnv);
    expect(out.created).toBe(false);
    const count = await globalQuery<{ n: number }>('select count(*)::int as n from users');
    expect(count[0]!.n).toBe(1);
  });

});
