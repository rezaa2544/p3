import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { runOnce } from '../src/queue/worker.js';
import { todayTehran } from '../src/lib/http.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

describe('اطلاعیه‌ها، اعلان‌ها و تکالیف', () => {
  it('اطلاعیه‌ها بر اساس مخاطب فیلتر می‌شوند', async () => {
    const admin = await env.login('adminA');
    const all = await env.request('POST', '/api/announcements', {
      auth: admin,
      body: { title: 'اطلاعیه عمومی', body: 'متن عمومی' },
    });
    expect(all.status).toBe(200);
    const forStudents = await env.request('POST', '/api/announcements', {
      auth: admin,
      body: { title: 'ویژه دانش‌آموزان', body: 'متن', audience: 'role', targetRole: 'student' },
    });
    expect(forStudents.status).toBe(200);
    const forClass = await env.request('POST', '/api/announcements', {
      auth: admin,
      body: { title: 'ویژه کلاس', body: 'متن', audience: 'class', targetClassId: env.fx.classA1 },
    });
    expect(forClass.status).toBe(200);
    const missingTarget = await env.request('POST', '/api/announcements', {
      auth: admin,
      body: { title: 'ناقص', body: 'متن', audience: 'class' },
    });
    expect(missingTarget.status).toBe(400);

    const s = await env.login('student1');
    const studentList = await env.request('GET', '/api/announcements', { auth: s });
    const titles = studentList.json.items.map((i: { title: string }) => i.title);
    expect(titles).toContain('اطلاعیه عمومی');
    expect(titles).toContain('ویژه دانش‌آموزان');
    expect(titles).toContain('ویژه کلاس');

    const t = await env.login('teacher1');
    const teacherList = await env.request('GET', '/api/announcements', { auth: t });
    const teacherTitles = teacherList.json.items.map((i: { title: string }) => i.title);
    expect(teacherTitles).toContain('اطلاعیه عمومی');
    expect(teacherTitles).not.toContain('ویژه دانش‌آموزان');
  });

  it('علامت‌گذاری خوانده‌شده کار می‌کند و student نمی‌تواند اطلاعیه بسازد', async () => {
    const admin = await env.login('adminA');
    const created = await env.request('POST', '/api/announcements', {
      auth: admin,
      body: { title: 'قابل خواندن', body: 'متن' },
    });
    const s = await env.login('student1');
    const list = await env.request('GET', '/api/announcements', { auth: s });
    const target = list.json.items.find((i: { title: string }) => i.title === 'قابل خواندن');
    expect(target.is_read).toBe(false);
    const read = await env.request('POST', `/api/announcements/${target.id}/read`, { auth: s });
    expect(read.status).toBe(200);
    const again = await env.request('GET', '/api/announcements', { auth: s });
    expect(again.json.items.find((i: { id: string }) => i.id === target.id).is_read).toBe(true);

    const denied = await env.request('POST', '/api/announcements', {
      auth: s,
      body: { title: 'تلاش', body: 'متن' },
    });
    expect(denied.status).toBe(403);
  });

  it('اعلان غیبت به ولی با جلوگیری از تکرار', async () => {
    const admin = await env.login('adminA');
    const key = `notify-${Date.now()}`;
    const res = await env.request('POST', '/api/attendance', {
      auth: admin,
      headers: { 'idempotency-key': key },
      body: {
        classId: env.fx.classA1,
        day: todayTehran(),
        periodNo: 2,
        records: [{ studentId: env.fx.student1, status: 'absent' }],
      },
    });
    expect(res.status).toBe(201);

    const jobs = await env.dbQuery("select count(*)::int as n from outbox_jobs where kind = 'notify_guardians_attendance'");
    expect(jobs[0].n).toBeGreaterThan(0);

    await runOnce();
    const g = await env.login('guardian1');
    const notes = await env.request('GET', '/api/notifications', { auth: g });
    expect(notes.status).toBe(200);
    const attendanceNotes = notes.json.items.filter((n: { kind: string }) => n.kind === 'attendance');
    expect(attendanceNotes.length).toBe(1);
    expect(attendanceNotes[0].title).toContain('غیبت');

    await runOnce();
    const again = await env.request('GET', '/api/notifications', { auth: g });
    expect(again.json.items.filter((n: { kind: string }) => n.kind === 'attendance').length).toBe(1);

    const readAll = await env.request('POST', '/api/notifications/read-all', { auth: g });
    expect(readAll.status).toBe(200);
    const after = await env.request('GET', '/api/notifications', { auth: g });
    expect(after.json.unread).toBe(0);
  });

  it('چرخه کامل تکلیف: ساخت، انتشار، ارسال و بازبینی', async () => {
    const t = await env.login('teacher1');
    const created = await env.request('POST', '/api/assignments', {
      auth: t,
      body: {
        classId: env.fx.classA1,
        subjectId: env.fx.subjectMath,
        title: 'تمرین فصل ۱',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        maxScore: 20,
        publish: true,
      },
    });
    expect(created.status).toBe(200);
    const assignmentId = created.json.id;

    const s = await env.login('student1');
    const list = await env.request('GET', '/api/assignments', { auth: s });
    expect(list.status).toBe(200);
    expect(list.json.items.map((a: { id: string }) => a.id)).toContain(assignmentId);

    const submit = await env.request('POST', `/api/assignments/${assignmentId}/submissions`, {
      auth: s,
      body: { body: 'پاسخ من' },
    });
    expect(submit.status).toBe(200);
    expect(submit.json.status).toBe('submitted');

    const subs = await env.request('GET', `/api/assignments/${assignmentId}/submissions`, { auth: t });
    expect(subs.status).toBe(200);
    expect(subs.json.items).toHaveLength(1);
    const submissionId = subs.json.items[0].id;

    const badScore = await env.request('POST', `/api/submissions/${submissionId}/review`, {
      auth: t,
      body: { score: 25, feedback: 'عالی' },
    });
    expect(badScore.status).toBe(400);

    const review = await env.request('POST', `/api/submissions/${submissionId}/review`, {
      auth: t,
      body: { score: 18, feedback: 'خوب' },
    });
    expect(review.status).toBe(200);
    expect(review.json.status).toBe('reviewed');
  });

  it('تکلیف منتشرنشده برای دانش‌آموز دیده نمی‌شود و دیگران نمی‌توانند پاسخ دهند', async () => {
    const t = await env.login('teacher1');
    const draft = await env.request('POST', '/api/assignments', {
      auth: t,
      body: {
        classId: env.fx.classA1,
        subjectId: env.fx.subjectMath,
        title: 'پیش‌نویس',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(draft.status).toBe(200);

    const s = await env.login('student1');
    const list = await env.request('GET', '/api/assignments', { auth: s });
    expect(list.json.items.map((a: { id: string }) => a.id)).not.toContain(draft.json.id);

    const submit = await env.request('POST', `/api/assignments/${draft.json.id}/submissions`, {
      auth: s,
      body: { body: 'تلاش' },
    });
    expect(submit.status).toBe(400);

    const otherTeacher = await env.login('teacher2');
    const otherClass = await env.request('POST', '/api/assignments', {
      auth: otherTeacher,
      body: {
        classId: env.fx.classA2,
        subjectId: env.fx.subjectMath,
        title: 'کلاس دیگر',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(otherClass.status).toBe(200);
    const s2 = await env.login('student1');
    const noAccess = await env.request('GET', '/api/assignments', { auth: s2 });
    expect(noAccess.json.items.map((a: { id: string }) => a.id)).not.toContain(otherClass.json.id);
  });

  it('دبیر بدون تخصیص نمی‌تواند تکلیف بسازد', async () => {
    const t = await env.login('teacher2');
    const res = await env.request('POST', '/api/assignments', {
      auth: t,
      body: {
        classId: env.fx.classA1,
        subjectId: env.fx.subjectMath,
        title: 'تلاش',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(res.status).toBe(403);
  });
});
