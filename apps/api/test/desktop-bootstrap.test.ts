import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closePool, globalQuery, migrate } from '../src/db.js';
import { resetConfigCache } from '../src/config.js';
import { ensureFirstSetup } from '../src/services/first-run.js';
import { verifyPassword } from '../src/security/password.js';

/**
 * «نخستین ورود» نسخهٔ میزکار.
 *
 * کاربر نهایی فایل EXE را نصب می‌کند و باید بلافاصله وارد شود؛ به همین دلیل بستهٔ میزکار
 * اعتبارنامهٔ ۱۲۳۴۵۶/۱۲۳۴۵۶ را با پرچم صریح `PAYESH_ALLOW_SHORT_ADMIN_PASSWORD=1`
 * می‌گذارد. این آزمون ثابت می‌کند:
 *   • بدون پرچم، رمز کوتاه رد می‌شود (سرور عمومی همان قاعدهٔ قبلی را دارد)
 *   • با پرچم، حساب ساخته می‌شود و ورود با همان رمز کار می‌کند
 *   • حساب همیشه «باید رمز تغییر کند» است و تغییر رمز به رمز کوتاه مجاز نیست
 */

const port = 25000 + (process.pid % 900);
let db: PGlite;
let server: PGLiteSocketServer;
let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'payesh-desktop-'));
  db = await PGlite.create({ dataDir: dir });
  server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.SESSION_SECRET = 'desktop-bootstrap-secret-0123456789-abcd';
  process.env.DB_POOL_MAX = '1';
  process.env.PAYESH_EMBEDDED_DB = '1';
  process.env.CSRF_DISABLED = '0';
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.LOGIN_RATE_LIMIT_MAX = '100000';
  process.env.LOG_LEVEL = 'silent';
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  resetConfigCache();
  await migrate();
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closePool();
  await server.stop();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

async function login(username: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
}

describe('نخستین ورود نسخهٔ میزکار (۱۲۳۴۵۶/۱۲۳۴۵۶)', () => {
  it('بدون پرچم صریح، رمز کوتاه رد می‌شود', async () => {
    const out = await ensureFirstSetup({
      ADMIN_USERNAME: '123456',
      ADMIN_PASSWORD: '123456',
    } as NodeJS.ProcessEnv);
    expect(out.created).toBe(false);
    expect(out.reason).toContain('۱۰');
    const rows = await globalQuery<{ n: number }>('select count(*)::int as n from users');
    expect(rows[0]!.n).toBe(0);
  });

  it('حتی با پرچم، رمز کوتاه‌تر از ۶ نویسه پذیرفته نمی‌شود', async () => {
    const out = await ensureFirstSetup({
      ADMIN_USERNAME: '123456',
      ADMIN_PASSWORD: '12345',
      PAYESH_ALLOW_SHORT_ADMIN_PASSWORD: '1',
    } as NodeJS.ProcessEnv);
    expect(out.created).toBe(false);
  });

  it('با پرچم میزکار، حساب مدیر با اعتبارنامهٔ نصب ساخته می‌شود و ورود کار می‌کند', async () => {
    const out = await ensureFirstSetup({
      ADMIN_USERNAME: '123456',
      ADMIN_PASSWORD: '123456',
      PAYESH_ALLOW_SHORT_ADMIN_PASSWORD: '1',
    } as NodeJS.ProcessEnv);
    expect(out.created).toBe(true);
    expect(out.schoolId).toBeTruthy();

    const row = await globalQuery<{ password_hash: string; must_change_password: boolean }>(
      'select password_hash, must_change_password from users where username = $1',
      ['123456'],
    );
    expect(row[0]!.must_change_password).toBe(true);
    expect(await verifyPassword('123456', row[0]!.password_hash)).toBe(true);

    const res = await login('123456', '123456');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      user: { username: string; mustChangePassword: boolean };
      memberships: { role: string }[];
      csrfToken: string;
    };
    expect(body.user.username).toBe('123456');
    expect(body.user.mustChangePassword).toBe(true);
    expect(body.memberships[0]!.role).toBe('school_admin');
  });

  it('تغییر رمز به رمز کوتاه مجاز نیست، اما رمز قوی پذیرفته می‌شود', async () => {
    const res = await login('123456', '123456');
    const cookie = String(res.headers['set-cookie']).split(';')[0]!;
    const { csrfToken } = JSON.parse(res.body) as { csrfToken: string };

    const short = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { currentPassword: '123456', newPassword: '123456' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.body).toContain('۱۰');

    const strong = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { currentPassword: '123456', newPassword: 'Payesh2Strong' },
    });
    expect(strong.statusCode).toBe(200);

    const after = await globalQuery<{ must_change_password: boolean }>(
      'select must_change_password from users where username = $1',
      ['123456'],
    );
    expect(after[0]!.must_change_password).toBe(false);

    // رمز قدیمی دیگر کار نمی‌کند و رمز جدید کار می‌کند
    expect((await login('123456', '123456')).statusCode).toBe(401);
    expect((await login('123456', 'Payesh2Strong')).statusCode).toBe(200);
  });
});
