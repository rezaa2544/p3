#!/usr/bin/env node
/**
 * آزمون بار واقعی پایش ۲ — تمام آماده‌سازی از طریق همان API عمومی انجام می‌شود
 * (هیچ اتصال مستقیم به دیتابیس لازم نیست، بنابراین روی هر محیطی با یک مدیر مجاز اجرا می‌شود).
 *
 * اجرا:
 *   BASE_URL=https://... LOAD_ADMIN_USER=admin LOAD_ADMIN_PASSWORD=... npm run test:load
 *
 * سناریوها مطابق الگوی استفاده واقعی مدرسه:
 *  ۱) شروع زنگ: خواندن فهرست کلاس و ثبت حضور گروهی
 *  ۲) ثبت/به‌روزرسانی نمرات یک ارزیابی
 *  ۳) پس از ساعات مدرسه: داشبورد مدیر و گزینه‌های فرم‌ها
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import autocannon from 'autocannon';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.LOAD_ADMIN_USER ?? 'admin';
const ADMIN_PASS = process.env.LOAD_ADMIN_PASSWORD ?? 'Payesh1404a';
const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 20);
const DURATION = Number(process.env.LOAD_DURATION ?? 10);
const STUDENTS = Number(process.env.LOAD_STUDENTS ?? 30);

let csrf = null;
let cookie = null;
let schoolId = null;

async function call(method, url, body, session) {
  const headers = { accept: 'application/json' };
  if (session) {
    headers.cookie = session.cookie;
    if (method !== 'GET') headers['x-csrf-token'] = session.csrf;
  } else {
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  }
  if (schoolId) headers['x-school-id'] = schoolId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`ورود مدیر ناموفق: ${res.status} ${await res.text()}`);
  const body = await res.json();
  cookie = String(res.headers.get('set-cookie')).split(';')[0];
  csrf = body.csrfToken;
  schoolId = body.memberships[0]?.schoolId;
  if (!schoolId) throw new Error('حساب مدیر به هیچ مدرسه‌ای متصل نیست');
  console.log(JSON.stringify({ step: 'login', user: body.user.username, schoolId }));
}

async function prepare() {
  const options = await call('GET', '/meta/options');
  let classId = options.classes.find((c) => c.title === 'بار-۱')?.id;
  if (!classId) {
    const created = await call('POST', '/classes', { title: 'بار-۱', capacity: 40 });
    classId = created.id;
  }
  let subjectId = options.subjects[0]?.id;
  if (!subjectId) subjectId = (await call('POST', '/subjects', { title: 'ریاضی', code: 'MATH', weeklyHours: 4 })).id;
  let termId = options.terms[0]?.id;
  if (!termId) throw new Error('برای آزمون بار، حداقل یک نیم‌سال تعریف کنید (seed داده نمونه این کار را می‌کند)');

  // اگر برای این کلاس/درس دبیری تخصیص یافته، همان را استفاده می‌کنیم؛ در غیر این صورت دبیر می‌سازیم.
  const existingTa = await call('GET', `/teaching-assignments?classId=${classId}`);
  let teacherId = existingTa.items.find((t) => t.subject_id === subjectId)?.teacher_user_id;
  const teacherUsername = `load_teacher_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  if (!teacherId) {
    const users = await call('GET', '/users?role=teacher&limit=50');
    teacherId = users.items.find((u) => u.username === teacherUsername)?.id;
    if (!teacherId) {
      const created = await call('POST', '/users', { username: teacherUsername, fullName: 'دبیر آزمون بار', role: 'teacher' });
      teacherId = created.id;
    }
    await call('POST', '/teaching-assignments', { classId, subjectId, teacherUserId: teacherId });
  }
  const teacherRow = (await call('GET', '/users?role=teacher&limit=200')).items.find((u) => u.id === teacherId);
  const teacherLogin = teacherRow?.username ?? teacherUsername;
  // رمز دبیر را با همان مسیر مجاز بازنشانی می‌کنیم تا ثبت نمره با نقش واقعی دبیر آزموده شود
  const reset = await call('POST', `/users/${teacherId}/reset-password`);
  const teacherPass = reset.temporaryPassword;

  // ورود جداگانه با نقش دبیر برای سناریوی ثبت نمره
  const teacherSession = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: teacherLogin, password: teacherPass }),
  });
  if (!teacherSession.ok) throw new Error(`ورود دبیر ناموفق: ${teacherSession.status}`);
  const teacherBody = await teacherSession.json();
  const teacherCookie = String(teacherSession.headers.get('set-cookie')).split(';')[0];
  const teacherCsrf = teacherBody.csrfToken;

  const assessment = await call(
    'POST',
    '/assessments',
    {
      classId,
      subjectId,
      termId,
      title: `ارزیابی بار ${new Date().toISOString().slice(0, 10)}`,
      kind: 'quiz',
      maxScore: 20,
    },
    { cookie: teacherCookie, csrf: teacherCsrf },
  );

  const roster = await call('GET', `/students?classId=${classId}&limit=200`);
  const studentIds = roster.items.map((s) => s.id);
  for (let i = studentIds.length; i < STUDENTS; i++) {
    const st = await call('POST', '/students', { firstName: `بار${i}`, lastName: 'آزمون', classId });
    studentIds.push(st.id);
  }

  console.log(JSON.stringify({ step: 'prepare', classId, subjectId, teacherId, students: studentIds.length, assessment: assessment.id }));
  return { classId, subjectId, termId, teacherId, studentIds, assessmentId: assessment.id, teacherCookie, teacherCsrf };
}

/**
 * درایور نوشتن هم‌زمان با کنترل دقیق هر درخواست (هر درخواست کلید و داده یکتا دارد).
 * p95/p99 و توزیع کدهای وضعیت را برمی‌گرداند.
 */
async function runWrites(name, fn, { connections = CONNECTIONS, seconds = DURATION } = {}) {
  const latencies = [];
  const statuses = new Map();
  let errors = 0;
  const deadline = Date.now() + seconds * 1000;

  async function worker(id) {
    let seq = 0;
    while (Date.now() < deadline) {
      seq++;
      try {
        const { status, ms } = await fn(id, seq);
        latencies.push(ms);
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      } catch {
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: connections }, (_, i) => worker(i)));
  latencies.sort((a, b) => a - b);
  const pick = (p) => (latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] * 10) / 10 : null);
  const total = [...statuses.values()].reduce((a, b) => a + b, 0);
  const ok = [...statuses.entries()].filter(([s]) => s >= 200 && s < 300).reduce((a, [, n]) => a + n, 0);
  const summary = {
    name,
    connections,
    durationSeconds: seconds,
    requests: total,
    requestsPerSecond: Math.round(total / seconds),
    latencyMs: { average: latencies.length ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : null, p50: pick(50), p95: pick(95), p99: pick(99), max: latencies.at(-1) ?? null },
    statusCodes: Object.fromEntries([...statuses.entries()].sort((a, b) => a[0] - b[0])),
    successRate: total ? Math.round((ok / total) * 1000) / 10 : 0,
    errors,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

function summarize(name, result) {
  const summary = {
    name,
    connections: result.connections,
    durationSeconds: result.duration,
    requests: result.requests.total,
    requestsPerSecond: Math.round(result.requests.average),
    latencyMs: {
      average: Math.round(result.latency.average * 10) / 10,
      p50: result.latency.p50,
      p97_5: result.latency.p97_5,
      p99: result.latency.p99,
      max: result.latency.max,
    },
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx: result.non2xx,
  };
  console.log(JSON.stringify(summary));
  return summary;
}

function run(title, opts) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({ ...opts, connections: CONNECTIONS, duration: DURATION }, (err, result) => {
      if (err) reject(err);
      else resolve(summarize(title, result));
    });
    autocannon.track(instance, { renderProgressBar: false });
  });
}

async function main() {
  await login();
  const fx = await prepare();

  const baseHeaders = { cookie, 'x-school-id': schoolId };
  let writeCounter = 0;
  const results = [];

  results.push(
    await run('شروع زنگ: فهرست کلاس', {
      url: `${BASE}/api/students?classId=${fx.classId}&limit=200`,
      method: 'GET',
      headers: baseHeaders,
    }),
  );

  results.push(
    await runWrites('شروع زنگ: ثبت حضور گروهی', async (worker, seq) => {
      // هر درخواست روز یکتا دارد؛ تاریخ به عقب می‌رود تا محدودیت «تاریخ آینده» نقض نشود
      const day = new Date(Date.UTC(2015, 0, 1) - (worker * 3000 + seq) * 86_400_000).toISOString().slice(0, 10);
      const started = performance.now();
      const res = await fetch(`${BASE}/api/attendance`, {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
          'idempotency-key': `load-${worker}-${seq}`,
        },
        body: JSON.stringify({
          classId: fx.classId,
          day,
          periodNo: 0,
          source: 'online',
          records: fx.studentIds.slice(0, STUDENTS).map((id) => ({ studentId: id, status: 'present' })),
        }),
      });
      await res.arrayBuffer();
      return { status: res.status, ms: performance.now() - started };
    }),
  );

  results.push(
    await run('ثبت نمرات ارزیابی', {
      url: `${BASE}/api/assessments/${fx.assessmentId}/grades`,
      method: 'POST',
      headers: { cookie: fx.teacherCookie, 'x-school-id': schoolId, 'x-csrf-token': fx.teacherCsrf, 'content-type': 'application/json' },
      body: JSON.stringify({
        grades: fx.studentIds.slice(0, STUDENTS).map((id, i) => ({ studentId: id, score: 10 + (i % 10) })),
      }),
    }),
  );

  results.push(
    await run('پس از مدرسه: داشبورد مدیر', {
      url: `${BASE}/api/dashboard`,
      method: 'GET',
      headers: baseHeaders,
    }),
  );

  results.push(
    await run('فرم‌ها: گزینه‌های کلاس/درس', {
      url: `${BASE}/api/meta/options`,
      method: 'GET',
      headers: baseHeaders,
    }),
  );

  const out = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    connections: CONNECTIONS,
    durationSeconds: DURATION,
    studentsPerWrite: STUDENTS,
    results,
  };
  const reportPath = path.join(process.cwd(), '.data', 'load-report.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(out, null, 2));
  console.log(`گزارش ذخیره شد: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
