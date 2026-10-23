import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { todayTehran } from '../src/lib/http.js';

let env: TestEnv;
const key = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

describe('کنترل دسترسی و جداسازی داده', () => {
  it('دبیر تخصیص‌یافته به کلاس می‌تواند حضور ثبت کند', async () => {
    const t = await env.login('teacher1');
    const res = await env.request('POST', '/api/attendance', {
      auth: t,
      headers: { 'idempotency-key': key() },
      body: {
        classId: env.fx.classA1,
        day: todayTehran(),
        periodNo: 1,
        records: [{ studentId: env.fx.student1, status: 'present' }],
      },
    });
    expect(res.status).toBe(201);
  });

  it('دبیر برای کلاس بدون تخصیص نمی‌تواند حضور ثبت کند', async () => {
    const t = await env.login('teacher1');
    const res = await env.request('POST', '/api/attendance', {
      auth: t,
      headers: { 'idempotency-key': key() },
      body: {
        classId: env.fx.classA2,
        day: todayTehran(),
        periodNo: 1,
        records: [{ studentId: env.fx.student2, status: 'present' }],
      },
    });
    expect(res.status).toBe(403);
  });

  it('دبیر بدون تخصیص نمی‌تواند برای کلاس حضور ثبت کند', async () => {
    const t = await env.login('teacher2');
    const res = await env.request('POST', '/api/attendance', {
      auth: t,
      headers: { 'idempotency-key': key() },
      body: {
        classId: env.fx.classA1,
        day: todayTehran(),
        periodNo: 2,
        records: [{ studentId: env.fx.student1, status: 'absent' }],
      },
    });
    expect(res.status).toBe(403);
  });

  it('فهرست دانش‌آموزان دبیر فقط شامل کلاس‌های خودش است', async () => {
    const t = await env.login('teacher1');
    const res = await env.request('GET', '/api/students', { auth: t });
    expect(res.status).toBe(200);
    const ids = res.json.items.map((s: { id: string }) => s.id);
    expect(ids).toEqual([env.fx.student1]);
  });

  it('ولی فقط فرزند خود را می‌بیند', async () => {
    const g = await env.login('guardian1');
    const children = await env.request('GET', '/api/me/children', { auth: g });
    expect(children.status).toBe(200);
    expect(children.json.items).toHaveLength(1);
    expect(children.json.items[0].id).toBe(env.fx.student1);

    const own = await env.request('GET', `/api/students/${env.fx.student1}`, { auth: g });
    expect(own.status).toBe(200);

    const other = await env.request('GET', `/api/students/${env.fx.student2}`, { auth: g });
    expect(other.status).toBe(403);

    const otherCard = await env.request('GET', `/api/report-card?studentId=${env.fx.student2}`, { auth: g });
    expect(otherCard.status).toBe(403);
  });

  it('دانش‌آموز نمی‌تواند حضور یا نمره ثبت کند و داده دیگری را ببیند', async () => {
    const s = await env.login('student1');
    const attendance = await env.request('POST', '/api/attendance', {
      auth: s,
      headers: { 'idempotency-key': key() },
      body: {
        classId: env.fx.classA1,
        day: todayTehran(),
        periodNo: 3,
        records: [{ studentId: env.fx.student1, status: 'present' }],
      },
    });
    expect(attendance.status).toBe(403);

    const grades = await env.request('GET', `/api/grades?studentId=${env.fx.student2}`, { auth: s });
    expect(grades.status).toBe(403);

    const students = await env.request('GET', '/api/students', { auth: s });
    expect(students.status).toBe(403);
  });

  it('اپراتور فناوری به محتوای آموزشی دسترسی ندارد', async () => {
    const it = await env.login('itA');
    const grades = await env.request('GET', `/api/grades?studentId=${env.fx.student1}`, { auth: it });
    expect(grades.status).toBe(403);
    const users = await env.request('GET', '/api/users', { auth: it });
    expect(users.status).toBe(200);
  });

  it('معاون نمی‌تواند کاربر بسازد یا audit را ببیند', async () => {
    const v = await env.login('viceA');
    const user = await env.request('POST', '/api/users', {
      auth: v,
      body: { username: 'someone', fullName: 'کاربر', role: 'teacher' },
    });
    expect(user.status).toBe(403);
    const audit = await env.request('GET', '/api/audit', { auth: v });
    expect(audit.status).toBe(403);
  });

  it('عبور از مرز مدرسه مسدود است', async () => {
    const b = await env.login('adminB');
    const viaHeader = await env.request('GET', '/api/students', {
      auth: b,
      headers: { 'x-school-id': env.fx.schoolA },
    });
    expect(viaHeader.status).toBe(401);

    const idor = await env.request('GET', `/api/students/${env.fx.student1}`, { auth: b });
    expect(idor.status).toBe(404);

    const attendance = await env.request('GET', `/api/attendance?studentId=${env.fx.student1}`, { auth: b });
    expect(attendance.status).toBe(404);

    const own = await env.request('GET', '/api/students', { auth: b });
    expect(own.status).toBe(200);
    expect(own.json.items.map((s: { id: string }) => s.id)).toEqual([env.fx.student3]);
  });

  it('دبیر به فهرست کاربران و audit دسترسی ندارد', async () => {
    const t = await env.login('teacher1');
    expect((await env.request('GET', '/api/users', { auth: t })).status).toBe(403);
    expect((await env.request('GET', '/api/audit', { auth: t })).status).toBe(403);
  });

  it('اپراتور نمی‌تواند نقش مدیر مدرسه بسازد (ارتقای سطح دسترسی)', async () => {
    const it = await env.login('itA');
    const res = await env.request('POST', '/api/users', {
      auth: it,
      body: { username: 'escalate', fullName: 'تلاش ارتقا', role: 'school_admin' },
    });
    expect(res.status).toBe(403);
    const teacher = await env.request('POST', '/api/users', {
      auth: it,
      body: { username: 'newteacher', fullName: 'دبیر جدید', role: 'teacher' },
    });
    expect(teacher.status).toBe(200);
    expect(teacher.json.temporaryPassword).toBeTruthy();
  });

  it('مدیر نمی‌تواند حساب خودش را غیرفعال کند', async () => {
    const a = await env.login('adminA');
    const me = await env.request('GET', '/api/auth/me', { auth: a });
    const res = await env.request('PATCH', `/api/users/${me.json.user.id}`, {
      auth: a,
      body: { isActive: false },
    });
    expect(res.status).toBe(400);
  });

  it('مدیر کل با یک عضویت بدون هدر مدرسه کار می‌کند، با چند مدرسه نیاز به انتخاب دارد', async () => {
    const hash = await import('../src/security/password.js').then((m) => m.hashPassword('Test1234pass'));
    const [solo] = await env.dbQuery<{ id: string }>(
      'insert into users (username, password_hash, full_name, is_super_admin) values ($1,$2,$3,true) returning id',
      ['superSolo', hash, 'مدیر کل تک‌مدرسه'],
    );
    await env.dbQuery('insert into memberships (user_id, school_id, role) values ($1,$2,$3)', [
      solo!.id,
      env.fx.schoolA,
      'school_admin',
    ]);
    const login = await env.login('superSolo', 'Test1234pass');
    const ok = await env.request('GET', '/api/schools', { auth: login });
    expect(ok.status).toBe(200);
    expect(ok.json.items.map((s: { id: string }) => s.id)).toContain(env.fx.schoolA);

    const [multi] = await env.dbQuery<{ id: string }>(
      'insert into users (username, password_hash, full_name, is_super_admin) values ($1,$2,$3,true) returning id',
      ['superMulti', hash, 'مدیر کل چندمدرسه'],
    );
    await env.dbQuery('insert into memberships (user_id, school_id, role) values ($1,$2,$3),($1,$4,$5)', [
      multi!.id,
      env.fx.schoolA,
      'school_admin',
      env.fx.schoolB,
      'school_admin',
    ]);
    const login2 = await env.login('superMulti', 'Test1234pass');
    const ambiguous = await env.request('GET', '/api/schools', { auth: login2 });
    expect(ambiguous.status).toBe(401);
    const scoped = await env.request('GET', '/api/schools', {
      auth: login2,
      headers: { 'x-school-id': env.fx.schoolB },
    });
    expect(scoped.status).toBe(200);
  });
});
