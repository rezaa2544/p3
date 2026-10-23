import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setupEnv, type TestEnv } from './helpers.js';
import { buildApp } from '../src/app.js';
import { resetConfigCache } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

let env: TestEnv;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

function multipart(
  fields: Record<string, string>,
  file: { name: string; type: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----payesh${randomBytes(6).toString('hex')}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
  );
  chunks.push(file.data);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('امنیت', () => {
  it('هدرهای امنیتی روی پاسخ‌های API تنظیم می‌شوند', async () => {
    const res = await env.request('GET', '/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('مسیر ناموجود پاسخ JSON می‌دهد و اطلاعات داخلی افشا نمی‌کند', async () => {
    const res = await env.request('GET', '/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.json)).not.toContain('stack');
  });

  it('ورودی SQL تزریقی اجرا نمی‌شود', async () => {
    const a = await env.login('adminA');
    const res = await env.request('GET', `/api/students?search=${encodeURIComponent("' OR 1=1 --")}`, { auth: a });
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([]);
    const all = await env.request('GET', '/api/students', { auth: a });
    expect(all.json.total).toBe(2);
  });

  it('شناسه نامعتبر UUID خطای کنترل‌شده می‌دهد', async () => {
    const a = await env.login('adminA');
    const res = await env.request('GET', '/api/students/not-a-uuid', { auth: a });
    expect(res.status).toBe(400);
  });

  it('آپلود فایل مجاز انجام و نام فایل پاک‌سازی می‌شود', async () => {
    const t = await env.login('teacher1');
    const payload = multipart(
      { entity: 'student', entityId: env.fx.student1 },
      { name: '../../etc/passwd.txt', type: 'text/plain', data: Buffer.from('محتوای آزمایشی') },
    );
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': payload.contentType, cookie: t.cookie, 'x-csrf-token': t.csrf },
      payload: payload.body,
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; original_name: string };
    expect(body.original_name).toBe('passwd.txt');

    const rows = await env.dbQuery('select storage_key, original_name, sha256 from files where id = $1', [body.id]);
    expect(rows[0].storage_key).not.toContain('..');
    expect(rows[0].original_name).not.toContain('..');
    expect(rows[0].sha256).toHaveLength(64);

    const download = await env.app.inject({ method: 'GET', url: `/api/files/${body.id}`, headers: { cookie: t.cookie } });
    expect(download.statusCode).toBe(200);
    expect(String(download.headers['content-disposition'])).toContain('attachment');
    expect(download.body).toBe('محتوای آزمایشی');
  });

  it('نوع فایل غیرمجاز رد می‌شود و حجم غیرمجاز کنترل می‌شود', async () => {
    const t = await env.login('teacher1');
    const exe = multipart({}, { name: 'virus.exe', type: 'application/x-msdownload', data: Buffer.from('MZ') });
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': exe.contentType, cookie: t.cookie, 'x-csrf-token': t.csrf },
      payload: exe.body,
    });
    expect(res.statusCode).toBe(400);

    const empty = multipart({}, { name: 'empty.txt', type: 'text/plain', data: Buffer.alloc(0) });
    const res2 = await env.app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': empty.contentType, cookie: t.cookie, 'x-csrf-token': t.csrf },
      payload: empty.body,
    });
    expect(res2.statusCode).toBe(400);
  });

  it('دانلود فایل بین مدارس و برای کاربر نامرتبط مسدود است', async () => {
    const admin = await env.login('adminA');
    const payload = multipart({}, { name: 'note.txt', type: 'text/plain', data: Buffer.from('محرمانه') });
    const created = await env.app.inject({
      method: 'POST',
      url: '/api/files',
      headers: { 'content-type': payload.contentType, cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: payload.body,
    });
    const fileId = (JSON.parse(created.body) as { id: string }).id;

    const b = await env.login('adminB');
    const cross = await env.app.inject({ method: 'GET', url: `/api/files/${fileId}`, headers: { cookie: b.cookie } });
    expect(cross.statusCode).toBe(404);

    const s = await env.login('student1');
    const other = await env.app.inject({ method: 'GET', url: `/api/files/${fileId}`, headers: { cookie: s.cookie } });
    expect(other.statusCode).toBe(403);
  });

  it('محتوای مخرب در اطلاعیه به‌صورت داده JSON برمی‌گردد نه HTML اجراشدنی', async () => {
    const a = await env.login('adminA');
    const payload = '<script>alert(1)</script>';
    const created = await env.request('POST', '/api/announcements', {
      auth: a,
      body: { title: 'اطلاعیه', body: payload },
    });
    expect(created.status).toBe(200);
    const list = await env.request('GET', '/api/announcements', { auth: a });
    expect(String(list.headers['content-type'])).toContain('application/json');
    expect(list.json.items.some((i: { body: string }) => i.body === payload)).toBe(true);
  });

  it('محدودیت نرخ ورود اعمال می‌شود', async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '2';
    resetConfigCache();
    const app2: FastifyInstance = await buildApp({ logger: false });
    await app2.ready();
    try {
      const attempt = () =>
        app2.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'adminA', password: 'wrong' },
        });
      const first = await attempt();
      const second = await attempt();
      const third = await attempt();
      expect([401, 429]).toContain(first.statusCode);
      expect([401, 429]).toContain(second.statusCode);
      expect(third.statusCode).toBe(429);
      expect(JSON.parse(third.body).error.code).toBe('RATE_LIMITED');
    } finally {
      await app2.close();
      delete process.env.LOGIN_RATE_LIMIT_MAX;
      resetConfigCache();
    }
  });
});
