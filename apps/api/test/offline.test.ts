import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { buildApp } from '../src/app.js';
import { runOnce } from '../src/queue/worker.js';
import { todayTehran } from '../src/lib/http.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

const bodyFor = (periodNo: number, status = 'present') => ({
  classId: env.fx.classA1,
  day: todayTehran(),
  periodNo,
  source: 'offline',
  capturedAt: new Date(Date.now() - 60_000).toISOString(),
  records: [{ studentId: env.fx.student1, status }],
});

describe('آفلاین و همگام‌سازی', () => {
  it('همگام‌سازی پس از بازراه‌اندازی سرور، داده تکراری نمی‌سازد', async () => {
    const admin = await env.login('adminA');
    const idem = `offline-restart-${Date.now()}`;
    const body = bodyFor(3);
    const first = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': idem },
      body,
    });
    expect(first.status).toBe(201);

    // شبیه‌سازی سرور تازه روی همان پایگاه داده
    const app2 = await buildApp({ logger: false });
    await app2.ready();
    try {
      const replay = await app2.inject({
        method: 'POST',
        url: '/api/attendance',
        headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, 'idempotency-key': idem },
        payload: body,
      });
      expect(replay.statusCode).toBe(201);
      expect((JSON.parse(replay.body) as { ids: string[] }).ids).toEqual(first.json.ids);
      expect(replay.headers['idempotent-replayed']).toBe('true');
    } finally {
      await app2.close();
    }
    const count = await env.dbQuery('select count(*)::int as n from attendance_records where period_no = 3');
    expect(count[0].n).toBe(1);
  });

  it('تعارض دو دستگاه شناسایی می‌شود و داده قبلی بازنویسی نمی‌شود', async () => {
    const admin = await env.login('adminA');
    const a = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': `deviceA-${Date.now()}` },
      body: bodyFor(4, 'present'),
    });
    expect(a.status).toBe(201);

    const b = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': `deviceB-${Date.now()}` },
      body: bodyFor(4, 'absent'),
    });
    expect(b.status).toBe(409);
    expect(b.json.error.details.existing).toHaveLength(1);
    expect(b.json.error.details.hint).toContain('اصلاح');

    const rows = await env.dbQuery('select status from attendance_records where period_no = 4');
    expect(rows[0].status).toBe('present');
  });

  it('انقضای نشست در میانه همگام‌سازی ۴۰۱ می‌دهد و چیزی ثبت نمی‌شود', async () => {
    const admin = await env.login('adminA');
    await env.dbQuery("update sessions set expires_at = now() - interval '1 hour'");
    const res = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': `expired-${Date.now()}` },
      body: bodyFor(5),
    });
    expect(res.status).toBe(401);
    const count = await env.dbQuery('select count(*)::int as n from attendance_records where period_no = 5');
    expect(count[0].n).toBe(0);
  });

  it('کلید idempotency بین کاربران قابل استفاده مجدد نیست', async () => {
    const admin = await env.login('adminA');
    const key = `shared-${Date.now()}`;
    const first = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': key },
      body: bodyFor(6),
    });
    expect(first.status).toBe(201);
    const vice = await env.login('viceA');
    const second = await env.request('POST', '/api/attendance', {
      auth: vice,
      headers: { 'idempotency-key': key },
      body: bodyFor(6),
    });
    expect(second.status).toBe(409);
  });

  it('صف عملیات ناموفق را حذف نمی‌کند و پس از سقف تلاش failed می‌شود', async () => {
    await env.dbQuery(
      "insert into outbox_jobs (kind, payload, max_attempts) values ('unknown-kind', '{}'::jsonb, 3)",
    );
    for (let i = 0; i < 3; i++) {
      const result = await runOnce();
      expect(result.failed).toBeGreaterThan(0);
      // عقب‌نشینی نمایی: تلاش بعدی در آینده زمان‌بندی شده است
      const scheduled = await env.dbQuery("select run_after > now() as later from outbox_jobs where kind = 'unknown-kind'");
      expect(scheduled[0].later).toBe(true);
      await env.dbQuery("update outbox_jobs set run_after = now() - interval '1 second' where kind = 'unknown-kind'");
    }
    const jobs = await env.dbQuery("select status, attempts, last_error from outbox_jobs where kind = 'unknown-kind'");
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].attempts).toBe(3);
    expect(jobs[0].last_error).toContain('ناشناخته');
  });

  it('عملیات آفلاین با source=offline و وضعیت در انتظار تا تأیید سرور', async () => {
    const admin = await env.login('adminA');
    const res = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': `src-${Date.now()}` },
      body: bodyFor(7, 'late'),
    });
    expect(res.status).toBe(201);
    const row = await env.dbQuery('select source, captured_at, recorded_at from attendance_records where period_no = 7');
    expect(row[0].source).toBe('offline');
    expect(row[0].captured_at).not.toBeNull();
    // زمان ثبت سرور جداگانه ثبت می‌شود
    expect(new Date(row[0].recorded_at).getTime()).toBeGreaterThan(new Date(row[0].captured_at).getTime());
  });
});
