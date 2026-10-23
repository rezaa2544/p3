import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { todayTehran } from '../src/lib/http.js';

let env: TestEnv;
let counter = 0;
const key = () => `att-${Date.now()}-${counter++}`;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

const record = (auth: { cookie: string; csrf: string }, body: Record<string, unknown>, idemKey = key()) =>
  env.request('POST', '/api/attendance', { auth, headers: { 'idempotency-key': idemKey }, body });

describe('حضور و غیاب', () => {
  it('ثبت گروهی حضور با تأیید سرور و زمان ثبت', async () => {
    const admin = await env.login('adminA');
    const res = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 5,
      records: [
        { studentId: env.fx.student1, status: 'present' },
        { studentId: env.fx.student2, status: 'absent' },
      ],
    });
    // student2 عضو classA1 نیست
    expect(res.status).toBe(400);
    expect(res.json.error.details.studentIds).toEqual([env.fx.student2]);

    const ok = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 5,
      records: [{ studentId: env.fx.student1, status: 'late', note: 'تأخیر ۱۰ دقیقه' }],
    });
    expect(ok.status).toBe(201);
    expect(ok.json.saved).toBe(1);
    expect(ok.json.serverTime).toBeTruthy();

    const rows = await env.dbQuery('select * from attendance_records where id = $1', [ok.json.ids[0]]);
    expect(rows[0].status).toBe('late');
    expect(rows[0].recorded_by).toBeTruthy();
    expect(rows[0].source).toBe('online');
  });

  it('ثبت تکراری بدون کلید یکسان تعارض می‌دهد و داده را بازنویسی نمی‌کند', async () => {
    const admin = await env.login('adminA');
    const dup = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 5,
      records: [{ studentId: env.fx.student1, status: 'present' }],
    });
    expect(dup.status).toBe(409);
    expect(dup.json.error.details.existing).toHaveLength(1);
    const rows = await env.dbQuery('select count(*)::int as n from attendance_records where class_id = $1 and period_no = 5', [
      env.fx.classA1,
    ]);
    expect(rows[0].n).toBe(1);
  });

  it('ارسال مجدد با همان Idempotency-Key داده تکراری نمی‌سازد', async () => {
    const admin = await env.login('adminA');
    const idem = key();
    const body = {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 6,
      records: [{ studentId: env.fx.student1, status: 'present' }],
    };
    const first = await record(admin, body, idem);
    expect(first.status).toBe(201);
    const before = await env.dbQuery('select count(*)::int as n from attendance_records');
    const second = await record(admin, body, idem);
    expect(second.status).toBe(201);
    expect(second.json.ids).toEqual(first.json.ids);
    expect(second.headers['idempotent-replayed']).toBe('true');
    const after = await env.dbQuery('select count(*)::int as n from attendance_records');
    expect(after[0].n).toBe(before[0].n);
  });

  it('همان کلید با بدنه متفاوت رد می‌شود', async () => {
    const admin = await env.login('adminA');
    const idem = key();
    const first = await record(
      admin,
      { classId: env.fx.classA1, day: todayTehran(), periodNo: 7, records: [{ studentId: env.fx.student1, status: 'present' }] },
      idem,
    );
    expect(first.status).toBe(201);
    const second = await record(
      admin,
      { classId: env.fx.classA1, day: todayTehran(), periodNo: 7, records: [{ studentId: env.fx.student1, status: 'absent' }] },
      idem,
    );
    expect(second.status).toBe(409);
    expect(second.json.error.code).toBe('CONFLICT');
  });

  it('تاریخ آینده و وضعیت نامعتبر رد می‌شود', async () => {
    const admin = await env.login('adminA');
    const future = await record(admin, {
      classId: env.fx.classA1,
      day: '2099-01-01',
      periodNo: 1,
      records: [{ studentId: env.fx.student1, status: 'present' }],
    });
    expect(future.status).toBe(400);

    const bad = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 8,
      records: [{ studentId: env.fx.student1, status: 'unknown-status' }],
    });
    expect(bad.status).toBe(400);

    const noKey = await env.request('POST', '/api/attendance', {
      auth: admin,
      body: {
        classId: env.fx.classA1,
        day: todayTehran(),
        periodNo: 9,
        records: [{ studentId: env.fx.student1, status: 'present' }],
      },
    });
    expect(noKey.status).toBe(400);
    expect(noKey.json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('ثبت آفلاین همگام‌شده با منبع offline و زمان ثبت دستگاه ذخیره می‌شود', async () => {
    const admin = await env.login('adminA');
    const capturedAt = new Date(Date.now() - 3600_000).toISOString();
    const res = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 10,
      source: 'offline',
      capturedAt,
      records: [{ studentId: env.fx.student1, status: 'excused' }],
    });
    expect(res.status).toBe(201);
    const rows = await env.dbQuery('select source, captured_at from attendance_records where id = $1', [res.json.ids[0]]);
    expect(rows[0].source).toBe('offline');
    expect(new Date(rows[0].captured_at).toISOString()).toBe(capturedAt);
  });

  it('اصلاح حضور با دلیل ثبت و audit می‌شود؛ دبیر مجاز به اصلاح نیست', async () => {
    const admin = await env.login('adminA');
    const created = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 11,
      records: [{ studentId: env.fx.student1, status: 'absent' }],
    });
    const id = created.json.ids[0];

    const teacher = await env.login('teacher1');
    const forbidden = await env.request('PUT', `/api/attendance/${id}`, {
      auth: teacher,
      body: { status: 'present', reason: 'ثبت اشتباه توسط دبیر' },
    });
    expect(forbidden.status).toBe(403);

    const shortReason = await env.request('PUT', `/api/attendance/${id}`, {
      auth: admin,
      body: { status: 'present', reason: 'بد' },
    });
    expect(shortReason.status).toBe(400);

    const ok = await env.request('PUT', `/api/attendance/${id}`, {
      auth: admin,
      body: { status: 'sick', reason: 'گواهی پزشکی ارائه شد' },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe('sick');

    const revisions = await env.dbQuery('select * from attendance_revisions where record_id = $1', [id]);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].reason).toContain('گواهی');
    const audit = await env.dbQuery("select * from audit_log where action = 'attendance.correct' and entity_id = $1", [id]);
    expect(audit.length).toBeGreaterThan(0);

    const same = await env.request('PUT', `/api/attendance/${id}`, {
      auth: admin,
      body: { status: 'sick', reason: 'دوباره همان وضعیت' },
    });
    expect(same.status).toBe(400);
  });

  it('تاریخچه‌ی اصلاح‌ها از مسیر API خوانده می‌شود (و برای رکورد ناشناس ۴۰۴)', async () => {
    const admin = await env.login('adminA');
    const created = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 2,
      records: [{ studentId: env.fx.student1, status: 'present' }],
    });
    expect(created.status).toBe(201);
    const id = created.json.ids[0];

    const empty = await env.request('GET', `/api/attendance/${id}/revisions`, { auth: admin });
    expect(empty.status).toBe(200);
    expect(empty.json.items).toEqual([]);

    await env.request('PUT', `/api/attendance/${id}`, {
      auth: admin,
      body: { status: 'late', reason: 'ورود با تأخیر ۱۵ دقیقه' },
    });
    await env.request('PUT', `/api/attendance/${id}`, {
      auth: admin,
      body: { status: 'excused', reason: 'تأیید موجه توسط معاون' },
    });

    const list = await env.request('GET', `/api/attendance/${id}/revisions`, { auth: admin });
    expect(list.status).toBe(200);
    expect(list.json.items).toHaveLength(2);
    expect(list.json.items[0].new_status).toBe('excused');
    expect(list.json.items[1].old_status).toBe('present');
    expect(list.json.items[0].changed_by_name).toBeTruthy();
    expect(list.json.items[0].reason).toContain('موجه');

    const teacher = await env.login('teacher1');
    const teachersView = await env.request('GET', `/api/attendance/${id}/revisions`, { auth: teacher });
    expect(teachersView.status).toBe(200);

    const missing = await env.request('GET', `/api/attendance/00000000-0000-4000-8000-000000000000/revisions`, {
      auth: admin,
    });
    expect(missing.status).toBe(404);
  });

  it('تاریخ رکوردها به‌صورت YYYY-MM-DD برمی‌گردد (نه رشته‌ی کامل ISO)', async () => {
    const admin = await env.login('adminA');
    const day = todayTehran();
    const created = await record(admin, {
      classId: env.fx.classA1,
      day,
      periodNo: 12,
      records: [{ studentId: env.fx.student1, status: 'present' }],
    });
    expect(created.status).toBe(201);

    const list = await env.request('GET', `/api/attendance?classId=${env.fx.classA1}&day=${day}`, { auth: admin });
    expect(list.status).toBe(200);
    const row = list.json.items.find((r: { period_no: number }) => Number(r.period_no) === 12);
    expect(row).toBeTruthy();
    expect(row.day).toBe(day);

    const student = await env.login('student1');
    const mine = await env.request('GET', `/api/me/attendance?from=${day}&to=${day}`, { auth: student });
    expect(mine.status).toBe(200);
    if (mine.json.items.length > 0) expect(mine.json.items[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('اصلاح رکورد مدرسه دیگر ۴۰۴ می‌دهد', async () => {
    const admin = await env.login('adminA');
    const created = await record(admin, {
      classId: env.fx.classA1,
      day: todayTehran(),
      periodNo: 4,
      records: [{ studentId: env.fx.student1, status: 'present' }],
    });
    expect([201, 409]).toContain(created.status);
    const rows = await env.dbQuery('select id from attendance_records where class_id = $1 and period_no = 4', [env.fx.classA1]);
    const b = await env.login('adminB');
    const res = await env.request('PUT', `/api/attendance/${rows[0].id}`, {
      auth: b,
      body: { status: 'absent', reason: 'تلاش دسترسی بین مدارس' },
    });
    expect(res.status).toBe(404);
  });

  it('گزارش حضور با داده واقعی محاسبه می‌شود و داده خالی صفر نمی‌سازد', async () => {
    const admin = await env.login('adminA');
    const report = await env.request('GET', `/api/attendance/report?from=2020-01-01&to=2020-01-02`, { auth: admin });
    expect(report.status).toBe(200);
    expect(report.json.items).toEqual([]);

    const today = todayTehran();
    const filled = await env.request('GET', `/api/attendance/report?from=${today}&to=${today}`, { auth: admin });
    expect(filled.status).toBe(200);
    expect(filled.json.items.length).toBeGreaterThan(0);
    const total = filled.json.items.reduce((s: number, i: { total: number }) => s + i.total, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('ولی فقط حضور فرزند خود را می‌بیند', async () => {
    const g = await env.login('guardian1');
    const ok = await env.request('GET', `/api/me/attendance?studentId=${env.fx.student1}`, { auth: g });
    expect(ok.status).toBe(200);
    const other = await env.request('GET', `/api/me/attendance?studentId=${env.fx.student2}`, { auth: g });
    expect(other.status).toBe(403);
  });

  it('دبیر گزارش کلاس دیگر را نمی‌بیند', async () => {
    const t = await env.login('teacher1');
    const today = todayTehran();
    const own = await env.request('GET', `/api/attendance/report?from=${today}&to=${today}&classId=${env.fx.classA1}`, {
      auth: t,
    });
    expect(own.status).toBe(200);
    const other = await env.request('GET', `/api/attendance/report?from=${today}&to=${today}&classId=${env.fx.classA2}`, {
      auth: t,
    });
    expect(other.status).toBe(403);
  });

  it('خروجی CSV با BOM فارسی و ثبت audit تولید می‌شود', async () => {
    const admin = await env.login('adminA');
    const today = todayTehran();
    const res = await env.request('GET', `/api/reports/attendance.csv?from=${today}&to=${today}`, { auth: admin });
    expect(res.status).toBe(200);
    expect(res.body.charCodeAt(0)).toBe(0xfeff);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(res.body).toContain('نام خانوادگی');
    const audit = await env.dbQuery("select count(*)::int as n from audit_log where action = 'report.export'");
    expect(audit[0].n).toBeGreaterThan(0);
  });
});

describe('رجیستری: ثبت گروهی با یک کلید عملیات', () => {
  it('یک Idempotency-Key برای چند دانش‌آموز، همه ردیف‌ها را ثبت می‌کند', async () => {
    const admin = await env.login('adminA');
    // دو دانش‌آموز در یک کلاس برای سنجش ثبت گروهی
    const created = await env.request('POST', '/api/students', {
      auth: admin,
      body: { firstName: 'گروهی', lastName: 'آزمون', classId: env.fx.classA1 },
    });
    expect(created.status).toBe(200);
    const res = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': `batch-${Date.now()}` },
      body: {
        classId: env.fx.classA1,
        day: '2026-01-05',
        periodNo: 1,
        records: [
          { studentId: env.fx.student1, status: 'present' },
          { studentId: created.json.id, status: 'absent' },
        ],
      },
    });
    expect(res.status).toBe(201);
    expect(res.json.saved).toBe(2);
    const rows = await env.dbQuery("select count(*)::int as n from attendance_records where day = '2026-01-05'");
    expect(rows[0].n).toBe(2);
  });
});
