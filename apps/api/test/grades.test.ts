import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
let assessmentId: string;
let secondAssessmentId: string;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

describe('نمرات، ارزیابی و کارنامه', () => {
  it('دبیر تخصیص‌یافته ارزیابی می‌سازد و برای کلاس دیگر ممنوع است', async () => {
    const t = await env.login('teacher1');
    const ok = await env.request('POST', '/api/assessments', {
      auth: t,
      body: {
        classId: env.fx.classA1,
        subjectId: env.fx.subjectMath,
        termId: env.fx.termA,
        title: 'آزمون میان‌ترم ریاضی',
        kind: 'midterm',
        maxScore: 20,
      },
    });
    expect(ok.status).toBe(200);
    assessmentId = ok.json.id;

    const other = await env.request('POST', '/api/assessments', {
      auth: t,
      body: {
        classId: env.fx.classA2,
        subjectId: env.fx.subjectMath,
        termId: env.fx.termA,
        title: 'آزمون کلاس دیگر',
        kind: 'quiz',
      },
    });
    expect(other.status).toBe(403);
  });

  it('بازه نمره و عضویت دانش‌آموز اعتبارسنجی می‌شود', async () => {
    const t = await env.login('teacher1');
    const outOfRange = await env.request('POST', `/api/assessments/${assessmentId}/grades`, {
      auth: t,
      body: { grades: [{ studentId: env.fx.student1, score: 25 }] },
    });
    expect(outOfRange.status).toBe(400);

    const notEnrolled = await env.request('POST', `/api/assessments/${assessmentId}/grades`, {
      auth: t,
      body: { grades: [{ studentId: env.fx.student2, score: 10 }] },
    });
    expect(notEnrolled.status).toBe(400);

    const ok = await env.request('POST', `/api/assessments/${assessmentId}/grades`, {
      auth: t,
      body: { grades: [{ studentId: env.fx.student1, score: 17.5 }] },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.saved).toBe(1);
    const rows = await env.dbQuery('select status, score from grades where id = $1', [ok.json.items[0].id]);
    expect(rows[0].status).toBe('submitted');
  });

  it('نمره تا تأیید نشدن برای دانش‌آموز و ولی دیده نمی‌شود', async () => {
    const s = await env.login('student1');
    const before = await env.request('GET', '/api/me/grades', { auth: s });
    expect(before.status).toBe(200);
    expect(before.json.items).toEqual([]);

    const g = await env.login('guardian1');
    const gb = await env.request('GET', `/api/me/grades?studentId=${env.fx.student1}`, { auth: g });
    expect(gb.status).toBe(200);
    expect(gb.json.items).toEqual([]);
  });

  it('تأیید نمرات توسط معاون ثبت و در audit منعکس می‌شود', async () => {
    const v = await env.login('viceA');
    const approve = await env.request('POST', `/api/assessments/${assessmentId}/approve`, { auth: v });
    expect(approve.status).toBe(200);
    expect(approve.json.approved).toBe(1);

    const audit = await env.dbQuery("select count(*)::int as n from audit_log where action = 'grades.approve'");
    expect(audit[0].n).toBeGreaterThan(0);

    const s = await env.login('student1');
    const after = await env.request('GET', '/api/me/grades', { auth: s });
    expect(after.json.items).toHaveLength(1);
    expect(Number(after.json.items[0].score)).toBe(17.5);
  });

  it('نمره تأییدشده توسط دبیر قابل تغییر نیست ولی مدیر با دلیل ثبت‌شده می‌تواند اصلاح کند', async () => {
    const admin = await env.login('adminA');
    const list = await env.request('GET', `/api/assessments/${assessmentId}/grades`, { auth: admin });
    const gradeId = list.json.items[0].id;

    const t = await env.login('teacher1');
    const denied = await env.request('PUT', `/api/grades/${gradeId}`, {
      auth: t,
      body: { score: 19, reason: 'اصلاح اشتباه محاسبه' },
    });
    expect(denied.status).toBe(403);

    const ok = await env.request('PUT', `/api/grades/${gradeId}`, {
      auth: admin,
      body: { score: 19, reason: 'بازبینی برگه توسط مدیر' },
    });
    expect(ok.status).toBe(200);
    expect(Number(ok.json.score)).toBe(19);
    expect(ok.json.status).toBe('submitted');

    const revisions = await env.dbQuery('select * from grade_revisions where grade_id = $1', [gradeId]);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].new_status).toBe('submitted');

    const reApprove = await env.request('POST', `/api/assessments/${assessmentId}/approve`, { auth: admin });
    expect(reApprove.status).toBe(200);
  });

  it('کارنامه میانگین وزنی را درست محاسبه می‌کند و ناقص بودن را اعلام می‌کند', async () => {
    const admin = await env.login('adminA');
    const t = await env.login('teacher1');
    const second = await env.request('POST', '/api/assessments', {
      auth: t,
      body: {
        classId: env.fx.classA1,
        subjectId: env.fx.subjectMath,
        termId: env.fx.termA,
        title: 'آزمونک دوم',
        kind: 'quiz',
        maxScore: 10,
      },
    });
    secondAssessmentId = second.json.id;
    // انتشار ارزیابی بدون نمره: کارنامه باید ناقص اعلام شود
    await env.request('POST', `/api/assessments/${secondAssessmentId}/approve`, { auth: admin });

    const card1 = await env.request('GET', `/api/report-card?studentId=${env.fx.student1}`, { auth: admin });
    expect(card1.status).toBe(200);
    const math1 = card1.json.subjects.find((s: { subjectTitle: string }) => s.subjectTitle === 'ریاضی');
    expect(math1.average).toBe(19);
    expect(math1.complete).toBe(false);
    expect(card1.json.dataNotice).toContain('ناقص');

    const g = await env.request('POST', `/api/assessments/${secondAssessmentId}/grades`, {
      auth: t,
      body: { grades: [{ studentId: env.fx.student1, score: 8 }] },
    });
    expect(g.status).toBe(200);
    const approve = await env.request('POST', `/api/assessments/${secondAssessmentId}/approve`, { auth: admin });
    expect(approve.status).toBe(200);

    const card2 = await env.request('GET', `/api/report-card?studentId=${env.fx.student1}`, { auth: admin });
    const math2 = card2.json.subjects.find((s: { subjectTitle: string }) => s.subjectTitle === 'ریاضی');
    // (19/20*20*1 + 8/10*20*1) / 2 = (19 + 16)/2 = 17.5
    expect(math2.average).toBe(17.5);
    expect(math2.complete).toBe(true);
    expect(card2.json.dataNotice).toBeNull();
    expect(card2.json.overall.hasData).toBe(true);
  });

  it('کارنامه بدون داده، مقدار ساختگی تولید نمی‌کند', async () => {
    const admin = await env.login('adminA');
    const card = await env.request('GET', `/api/report-card?studentId=${env.fx.student2}`, { auth: admin });
    expect(card.status).toBe(200);
    expect(card.json.overall.average).toBeNull();
    expect(card.json.overall.hasData).toBe(false);
    expect(card.json.dataNotice).toContain('داده کافی');
  });

  it('ولی به نمره فرزند دیگر دسترسی ندارد و دانش‌آموز نمی‌تواند نمره دیگری را ببیند', async () => {
    const g = await env.login('guardian1');
    const other = await env.request('GET', `/api/grades?studentId=${env.fx.student2}`, { auth: g });
    expect(other.status).toBe(403);

    const s = await env.login('student1');
    const own = await env.request('GET', `/api/report-card?studentId=${env.fx.student1}`, { auth: s });
    expect(own.status).toBe(200);
    const otherStudent = await env.request('GET', `/api/report-card?studentId=${env.fx.student2}`, { auth: s });
    expect(otherStudent.status).toBe(403);
  });

  it('مدیر مدرسه دیگر به نمرات دسترسی ندارد', async () => {
    const b = await env.login('adminB');
    const res = await env.request('GET', `/api/grades?studentId=${env.fx.student1}`, { auth: b });
    expect(res.status).toBe(404);
  });
});
