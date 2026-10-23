import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, PASSWORD, type TestEnv } from './helpers.js';
import { totpCode } from '../src/security/totp.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupEnv();
});

afterAll(async () => {
  await env.close();
});

describe('سلامت و احراز هویت', () => {
  it('health عمومی و بدون نیاز به ورود پاسخ می‌دهد', async () => {
    const res = await env.request('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('ok');
    expect(res.json.db).toBe('ok');
    expect(res.json.migrations).toBeGreaterThan(0);
  });

  it('منابع محافظت‌شده بدون ورود 401 می‌دهند', async () => {
    const res = await env.request('GET', '/api/students');
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('UNAUTHORIZED');
  });

  it('رمز اشتباه 401 می‌دهد و پیام افشاکننده نیست', async () => {
    const res = await env.request('POST', '/api/auth/login', {
      body: { username: 'adminA', password: 'wrong-password' },
    });
    expect(res.status).toBe(401);
    expect(res.json.error.message).toContain('نادرست');
    expect(JSON.stringify(res.json)).not.toContain('adminA');
  });

  it('ورود موفق، نشست و CSRF برمی‌گرداند و کوکی امن است', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'adminA', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const body = res.json() as { csrfToken?: string };
    expect(body.csrfToken).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('درخواست تغییردهنده بدون CSRF رد می‌شود', async () => {
    const auth = await env.login('adminA');
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: { cookie: auth.cookie },
      payload: { title: 'عنوان', body: 'متن' },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CSRF_FAILED');
  });

  it('CSRF نادرست رد می‌شود', async () => {
    const auth = await env.login('adminA');
    const res = await env.request('POST', '/api/announcements', {
      auth: { cookie: auth.cookie, csrf: 'wrong-token' },
      body: { title: 'عنوان', body: 'متن' },
    });
    expect(res.status).toBe(403);
  });

  it('خروج از حساب نشست را باطل می‌کند', async () => {
    const auth = await env.login('adminA');
    const ok = await env.request('GET', '/api/auth/me', { auth });
    expect(ok.status).toBe(200);
    const out = await env.request('POST', '/api/auth/logout', { auth });
    expect(out.status).toBe(200);
    const after = await env.request('GET', '/api/auth/me', { auth });
    expect(after.status).toBe(401);
  });

  it('تغییر رمز با رمز فعلی نادرست رد می‌شود و با رمز درست اعمال می‌شود', async () => {
    const auth = await env.login('viceA');
    const bad = await env.request('POST', '/api/auth/change-password', {
      auth,
      body: { currentPassword: 'nope', newPassword: 'NewPass12345' },
    });
    expect(bad.status).toBe(400);
    const wrongPolicy = await env.request('POST', '/api/auth/change-password', {
      auth,
      body: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(wrongPolicy.status).toBe(400);
    const good = await env.request('POST', '/api/auth/change-password', {
      auth,
      body: { currentPassword: PASSWORD, newPassword: 'NewPass12345' },
    });
    expect(good.status).toBe(200);
    await expect(env.login('viceA', PASSWORD, env.fx.schoolA)).rejects.toThrow();
    const relogin = await env.login('viceA', 'NewPass12345');
    expect(relogin.csrf).toBeTruthy();
  });

  it('قفل حساب پس از تلاش‌های ناموفق مکرر', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await env.request('POST', '/api/auth/login', {
        body: { username: 'guardian2', password: `wrong-${i}` },
      });
      expect([401]).toContain(res.status);
    }
    const locked = await env.request('POST', '/api/auth/login', {
      body: { username: 'guardian2', password: PASSWORD },
    });
    expect(locked.status).toBe(429);
    expect(locked.json.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('نشست منقضی رد می‌شود', async () => {
    const auth = await env.login('adminA');
    await env.dbQuery("update sessions set expires_at = now() - interval '1 minute'");
    const res = await env.request('GET', '/api/auth/me', { auth });
    expect(res.status).toBe(401);
  });

  it('MFA: فعال‌سازی، ورود بدون کد و ورود با کد', async () => {
    const auth = await env.login('teacher2');
    const enroll = await env.request('POST', '/api/auth/mfa/enroll', { auth });
    expect(enroll.status).toBe(200);
    const secret = enroll.json.secret as string;
    expect(enroll.json.uri).toContain('otpauth://');

    const wrong = await env.request('POST', '/api/auth/mfa/confirm', { auth, body: { code: '000000' } });
    expect(wrong.status).toBe(400);

    const counter = Math.floor(Date.now() / 1000 / 30);
    const code = totpCode(secret, counter);
    const confirm = await env.request('POST', '/api/auth/mfa/confirm', { auth, body: { code } });
    expect(confirm.status).toBe(200);

    const noCode = await env.request('POST', '/api/auth/login', {
      body: { username: 'teacher2', password: PASSWORD },
    });
    expect(noCode.status).toBe(401);
    expect(noCode.json.error.code).toBe('MFA_REQUIRED');

    const withCode = await env.request('POST', '/api/auth/login', {
      body: { username: 'teacher2', password: PASSWORD, mfaCode: totpCode(secret, Math.floor(Date.now() / 1000 / 30)) },
    });
    expect(withCode.status).toBe(200);
  });
});
