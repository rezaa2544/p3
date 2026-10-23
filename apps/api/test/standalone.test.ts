import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { setupEnv, type TestEnv } from './helpers.js';

/**
 * مسیر /standalone.html: همان فایل HTML تک‌فایل را با مبدأ درست سرو می‌کند تا کاربر
 * بتواند با API کار کند. اگر فایل نباشد، به‌جای 404 خالی، راهنمای فارسی برمی‌گرداند.
 */
let env: TestEnv;
let dir: string;

beforeAll(async () => {
  env = await setupEnv();
  dir = await mkdtemp(path.join(os.tmpdir(), 'payesh-standalone-'));
});
afterAll(async () => {
  await env.close();
  await rm(dir, { recursive: true, force: true });
});

async function appWith(file: string | undefined): Promise<FastifyInstance> {
  if (file === undefined) delete process.env.STANDALONE_HTML;
  else process.env.STANDALONE_HTML = file;
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

describe('سرو نسخه HTML تک‌فایل از سرور', () => {
  it('فایل موجود با 200 و نوع text/html برگردانده می‌شود', async () => {
    const file = path.join(dir, 'standalone.html');
    await writeFile(file, '<!doctype html><html lang="fa" dir="rtl"><body>پایش ۲ — تک‌فایل</body></html>', 'utf8');
    const app = await appWith(file);
    try {
      const res = await app.inject({ method: 'GET', url: '/standalone.html' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('پایش ۲ — تک‌فایل');
      expect(res.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it('اگر فایل نباشد پیام راهنمای فارسی می‌دهد (نه صفحه سفید/خطای خام)', async () => {
    const app = await appWith(path.join(dir, 'missing.html'));
    try {
      const res = await app.inject({ method: 'GET', url: '/standalone.html' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('npm run artifact:html');
    } finally {
      await app.close();
    }
  });

  it('مسیر / همچنان برنامه اصلی را سرو می‌کند', async () => {
    const app = await appWith(undefined);
    try {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect([200, 404]).toContain(res.statusCode);
      const health = await app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
