import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let staticApp: FastifyInstance | null = null;
let webDir = '';

beforeAll(async () => {
  env = await setupEnv();
  webDir = await mkdtemp(path.join(os.tmpdir(), 'payesh-web-'));
  await writeFile(path.join(webDir, 'index.html'), '<!doctype html><html lang="fa"><title>PAYESH-SPA-MARKER</title></html>');
  process.env.WEB_DIST = webDir;
  staticApp = await buildApp({ logger: false });
  await staticApp.ready();
});

afterAll(async () => {
  await staticApp?.close();
  delete process.env.WEB_DIST;
  if (webDir) await rm(webDir, { recursive: true, force: true });
  await env.close();
});

describe('سرو رابط کاربری و مسیرهای SPA', () => {
  it('بازکردن مستقیم مسیرهای عمیق (مثل /login و /attendance) صفحه‌ی برنامه را می‌دهد', async () => {
    for (const url of ['/', '/login', '/attendance', '/report-card?studentId=abc']) {
      const res = await staticApp!.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body, url).toContain('PAYESH-SPA-MARKER');
    }
  });

  it('مسیر ناموجود زیر /api همچنان ۴۰۴ JSON می‌دهد (نه index.html)', async () => {
    const res = await staticApp!.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.body) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('درخواست فایل ناموجود (مثل /assets/x.js) ۴۰۴ می‌دهد، نه index.html', async () => {
    for (const url of ['/assets/missing-abc123.js', '/sw.js', '/manifest.webmanifest']) {
      const res = await staticApp!.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('PAYESH-SPA-MARKER');
    }
  });

  it('/api/health و /standalone.html با وجود رابط کاربری سالم می‌مانند', async () => {
    const health = await staticApp!.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    const standalone = await staticApp!.inject({ method: 'GET', url: '/standalone.html' });
    expect([200, 404]).toContain(standalone.statusCode);
  });
});
