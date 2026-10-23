import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, getApiContext, setApiContext } from './api.js';
import { setOnline } from '../test/setup.js';

function mockFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  setApiContext({ csrfToken: null, schoolId: null });
  setOnline(true);
});

describe('کلاینت API', () => {
  it('هدر مدرسه فعال و CSRF را برای درخواست‌های تغییردهنده می‌فرستد', async () => {
    setApiContext({ csrfToken: 'csrf-123', schoolId: 'school-1' });
    const fn = mockFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await api('/attendance', { method: 'POST', body: { a: 1 } });
    const [, init] = fn.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-csrf-token']).toBe('csrf-123');
    expect(headers['x-school-id']).toBe('school-1');
    expect(headers['content-type']).toBe('application/json');
    expect(init.credentials).toBe('include');
  });

  it('برای GET توکن CSRF ارسال نمی‌شود', async () => {
    setApiContext({ csrfToken: 'csrf-123', schoolId: null });
    const fn = mockFetch(async () => new Response('{"items":[]}', { status: 200 }));
    await api('/students');
    const [, init] = fn.mock.calls[0]!;
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('خطای سرور به ApiError با پیام فارسی تبدیل می‌شود', async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'دسترسی مجاز نیست', requestId: 'req-1' } }), {
        status: 403,
      }),
    );
    await expect(api('/students')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'دسترسی مجاز نیست' });
  });

  it('قطع ارتباط به NetworkError با پیام روشن تبدیل می‌شود', async () => {
    setOnline(false);
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await api('/students').catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).message).toContain('قطع');
  });

  it('۴۰۱ رویداد خروج را اعلام می‌کند', async () => {
    const listener = vi.fn();
    window.addEventListener('payesh:unauthorized', listener);
    mockFetch(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'ورود لازم است' } }), { status: 401 }));
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener('payesh:unauthorized', listener);
  });

  it('پاسخ خالی و خطای غیر JSON را کنترل می‌کند', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
    mockFetch(async () => new Response('<html>bad</html>', { status: 500 }));
    const err = await api('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain('ناموفق');
    expect(getApiContext().schoolId).toBeNull();
  });
});
