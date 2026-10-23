import { closePool, globalQuery } from '../db.js';
import { hashPassword } from '../security/password.js';
import { ensureDatabase, stopEmbeddedDatabase } from './env.js';

/**
 * داده نمونه کاملاً ساختگی برای توسعه و دمو.
 * هیچ داده واقعی دانش‌آموز در این فایل نیست و در محیط تولید اجرا نمی‌شود.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261023);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;

const FIRST = ['آرمین', 'سارا', 'نیما', 'زهرا', 'محمدرضا', 'فاطمه', 'علی', 'مریم', 'حسین', 'الهام', 'پارسا', 'نازنین', 'امیرحسین', 'ریحانه', 'یاسین', 'مهسا'];
const LAST = ['احمدی', 'رضایی', 'کریمی', 'موسوی', 'حسینی', 'صادقی', 'نوری', 'کاظمی', 'شریفی', 'قاسمی'];
const TEACHERS = [
  ['مریم', 'تهرانی'],
  ['رضا', 'اکبری'],
  ['سمیرا', 'دانش'],
  ['کاوه', 'سلیمی'],
];
const SUBJECTS = [
  ['ریاضی', 'MATH', 4],
  ['فارسی', 'FA', 4],
  ['علوم تجربی', 'SCI', 3],
  ['زبان انگلیسی', 'ENG', 3],
  ['مطالعات اجتماعی', 'SOC', 2],
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed در محیط تولید مجاز نیست');
  if (process.env.SEED_DEMO !== '1') throw new Error('برای اجرای seed متغیر SEED_DEMO=1 را تنظیم کنید');
  const password = process.env.SEED_PASSWORD ?? 'Payesh1404a';
  await ensureDatabase();

  const exists = await globalQuery<{ id: string }>("select id from schools where code = 'DEMO-001'");
  if (exists[0]) {
    console.log(JSON.stringify({ ok: true, skipped: true, schoolId: exists[0].id, reason: 'داده نمونه از قبل موجود است' }));
    await closePool();
    await stopEmbeddedDatabase();
    return;
  }

  const org = (await globalQuery<{ id: string }>("insert into organizations (name) values ('مجموعه آموزشی نمونه پایش') returning id"))[0]!;
  const school = (
    await globalQuery<{ id: string }>(
      `insert into schools (org_id, name, code, city) values ($1, 'دبیرستان نمونه پایش', 'DEMO-001', 'تهران') returning id`,
      [org.id],
    )
  )[0]!;

  const year = (
    await globalQuery<{ id: string }>(
      `insert into academic_years (school_id, title, starts_on, ends_on, is_current)
       values ($1, '۱۴۰۴-۱۴۰۵', '2025-09-23', '2026-06-20', true) returning id`,
      [school.id],
    )
  )[0]!;
  const term1 = (
    await globalQuery<{ id: string }>(
      `insert into terms (academic_year_id, title, seq, starts_on, ends_on)
       values ($1, 'نیم‌سال اول', 1, '2025-09-23', '2026-01-20') returning id`,
      [year.id],
    )
  )[0]!;
  await globalQuery(
    `insert into terms (academic_year_id, title, seq, starts_on, ends_on)
     values ($1, 'نیم‌سال دوم', 2, '2026-01-21', '2026-06-20')`,
    [year.id],
  );

  const gradeLevels: string[] = [];
  for (const [i, title] of ['پایه هفتم', 'پایه هشتم', 'پایه نهم'].entries()) {
    const row = await globalQuery<{ id: string }>(
      'insert into grade_levels (school_id, title, seq) values ($1,$2,$3) returning id',
      [school.id, title, i + 1],
    );
    gradeLevels.push(row[0]!.id);
  }

  const classIds: string[] = [];
  for (const [i, title] of ['هفتم الف', 'هشتم الف'].entries()) {
    const row = await globalQuery<{ id: string }>(
      'insert into classes (school_id, academic_year_id, grade_level_id, title, capacity) values ($1,$2,$3,$4,$5) returning id',
      [school.id, year.id, gradeLevels[i]!, title, 30],
    );
    classIds.push(row[0]!.id);
  }
  const class3 = await globalQuery<{ id: string }>(
    'insert into classes (school_id, academic_year_id, grade_level_id, title, capacity) values ($1,$2,$3,$4,$5) returning id',
    [school.id, year.id, gradeLevels[2]!, 'نهم الف', 28],
  );
  classIds.push(class3[0]!.id);

  const subjectIds: string[] = [];
  for (const [title, code, hours] of SUBJECTS) {
    const row = await globalQuery<{ id: string }>(
      'insert into subjects (school_id, title, code, weekly_hours) values ($1,$2,$3,$4) returning id',
      [school.id, title, code, hours],
    );
    subjectIds.push(row[0]!.id);
  }

  for (const [i, p] of Array.from({ length: 6 }, (_, i) => i + 1).entries()) {
    await globalQuery(
      'insert into bell_periods (school_id, period_no, starts_at, ends_at) values ($1,$2,$3,$4)',
      [school.id, p, `${String(7 + i).padStart(2, '0')}:00`, `${String(7 + i).padStart(2, '0')}:45`],
    );
  }

  const hash = await hashPassword(password);
  const mkUser = async (username: string, fullName: string, role: string, superAdmin = false) => {
    const u = await globalQuery<{ id: string }>(
      `insert into users (username, password_hash, full_name, is_super_admin) values ($1,$2,$3,$4) returning id`,
      [username, hash, fullName, superAdmin],
    );
    if (role !== 'super') {
      await globalQuery('insert into memberships (user_id, school_id, role) values ($1,$2,$3)', [u[0]!.id, school.id, role]);
    }
    return u[0]!.id;
  };

  const adminId = await mkUser('admin', 'مدیر مدرسه نمونه', 'school_admin');
  await mkUser('sysadmin', 'مدیر کل سامانه', 'super', true);
  await mkUser('moaven', 'معاون آموزشی', 'vice_principal');
  await mkUser('it', 'مسئول فناوری', 'it_operator');
  await mkUser('finance', 'مسئول مالی', 'finance');
  await mkUser('counselor', 'مشاور مدرسه', 'counselor');

  const teacherIds: string[] = [];
  for (const [i, [first, last]] of TEACHERS.entries()) {
    teacherIds.push(await mkUser(`teacher${i + 1}`, `${first} ${last}`, 'teacher'));
  }

  // تخصیص دبیران به درس/کلاس (هر درس یک دبیر در همه کلاس‌ها)
  for (const classId of classIds) {
    for (const [idx, subjectId] of subjectIds.entries()) {
      await globalQuery(
        `insert into teaching_assignments (school_id, academic_year_id, class_id, subject_id, teacher_user_id)
         values ($1,$2,$3,$4,$5)`,
        [school.id, year.id, classId, subjectId, teacherIds[idx % teacherIds.length]!],
      );
    }
  }

  // برنامه هفتگی: شنبه تا چهارشنبه (weekday 6=شنبه در PostgreSQL dow)
  for (const classId of classIds) {
    for (let weekday = 6; weekday <= 10; weekday++) {
      for (let period = 1; period <= 4; period++) {
        const subjectId = subjectIds[(weekday + period) % subjectIds.length]!;
        await globalQuery(
          `insert into timetable (school_id, academic_year_id, class_id, weekday, period_no, subject_id, teacher_user_id)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict do nothing`,
          [school.id, year.id, classId, weekday % 7, period, subjectId, teacherIds[period % teacherIds.length]!],
        );
      }
    }
  }

  // دانش‌آموزان و اولیا
  const studentIds: string[] = [];
  let counter = 1;
  for (const classId of classIds) {
    for (let i = 0; i < 12; i++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const username = `student${counter}`;
      const userId = await mkUser(username, `${first} ${last}`, 'student');
      const st = await globalQuery<{ id: string }>(
        `insert into students (school_id, user_id, first_name, last_name, gender, national_id)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [school.id, userId, first, last, counter % 2 ? 'male' : 'female', String(1000000000 + counter)],
      );
      studentIds.push(st[0]!.id);
      await globalQuery(
        `insert into enrollments (student_id, academic_year_id, class_id) values ($1,$2,$3)`,
        [st[0]!.id, year.id, classId],
      );
      counter++;
    }
  }

  for (let g = 1; g <= 12; g++) {
    const guardianId = await mkUser(`guardian${g}`, `ولی نمونه ${g}`, 'guardian');
    const children = studentIds.slice((g - 1) * 3, (g - 1) * 3 + 3);
    for (const [i, childId] of children.entries()) {
      await globalQuery(
        `insert into student_guardians (student_id, guardian_user_id, relation, is_primary, can_view_grades, can_view_attendance)
         values ($1,$2,$3,$4,true,true)`,
        [childId, guardianId, i === 0 ? 'father' : 'mother', i === 0],
      );
    }
  }

  // تاریخ امروز تهران
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran' }).format(new Date());
  const today = new Date(todayStr + 'T00:00:00Z');

  // حضور و غیاب ۱۰ روز کاری گذشته
  const attendanceRows: { studentId: string; classId: string; day: string; status: string }[] = [];
  for (let back = 0; back < 10; back++) {
    const day = addDays(today, -back);
    const dow = day.getUTCDay();
    if (dow === 5) continue; // جمعه
    for (const [ci, classId] of classIds.entries()) {
      for (let i = 0; i < 12; i++) {
        const studentId = studentIds[ci * 12 + i]!;
        const r = rand();
        const status = r > 0.93 ? 'absent' : r > 0.88 ? 'late' : r > 0.86 ? 'sick' : 'present';
        attendanceRows.push({ studentId, classId, day: iso(day), status });
      }
    }
  }
  for (const row of attendanceRows) {
    await globalQuery(
      `insert into attendance_records (school_id, academic_year_id, class_id, student_id, day, period_no, status, recorded_by)
       values ($1,$2,$3,$4,$5,0,$6,$7) on conflict do nothing`,
      [school.id, year.id, row.classId, row.studentId, row.day, row.status, adminId],
    );
  }

  // ارزیابی و نمرات (تأییدشده برای نیم‌سال اول)
  for (const classId of classIds) {
    const classStudents = studentIds.slice(classIds.indexOf(classId) * 12, classIds.indexOf(classId) * 12 + 12);
    for (const subjectId of subjectIds) {
      const ta = await globalQuery<{ id: string; teacher_user_id: string }>(
        'select id, teacher_user_id from teaching_assignments where class_id = $1 and subject_id = $2',
        [classId, subjectId],
      );
      if (!ta[0]) continue;
      for (const [title, kind, max] of [
        ['آزمون میان‌term', 'midterm', 20],
        ['آزمونک کلاسی', 'quiz', 10],
      ] as const) {
        const assessment = await globalQuery<{ id: string }>(
          `insert into assessments (school_id, academic_year_id, term_id, teaching_assignment_id, title, kind, max_score, weight, held_on, status, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,1,'2025-11-10','published',$8) returning id`,
          [school.id, year.id, term1.id, ta[0].id, title.replace('میان‌term', 'میان‌ترم'), kind, max, ta[0].teacher_user_id],
        );
        for (const studentId of classStudents) {
          const score = Math.round((0.5 + rand() * 0.5) * max * 100) / 100;
          await globalQuery(
            `insert into grades (assessment_id, student_id, score, status, entered_by, approved_by, approved_at)
             values ($1,$2,$3,'approved',$4,$4,now()) on conflict do nothing`,
            [assessment[0]!.id, studentId, score, ta[0].teacher_user_id],
          );
        }
      }
    }
  }

  // تکالیف
  for (const [i, classId] of classIds.entries()) {
    const ta = await globalQuery<{ id: string; teacher_user_id: string }>(
      'select id, teacher_user_id from teaching_assignments where class_id = $1 limit 2',
      [classId],
    );
    if (!ta[1]) continue;
    await globalQuery(
      `insert into assignments (school_id, academic_year_id, teaching_assignment_id, title, description, due_at, max_score, published_at, created_by)
       values ($1,$2,$3,$4,$5, now() + interval '3 days', 20, now(), $6)`,
      [school.id, year.id, ta[1].id, `تمرین شماره ${i + 1}`, 'تمرین‌های فصل جاری را انجام دهید.', ta[1].teacher_user_id],
    );
  }

  await globalQuery(
    `insert into announcements (school_id, academic_year_id, title, body, audience, created_by, published_at)
     values ($1,$2,'جلسه اولیا و مربیان','جلسه اولیا روز پنجشنبه ساعت ۱۶ در سالن مدرسه برگزار می‌شود.','all',$3,now())`,
    [school.id, year.id, adminId],
  );

  await globalQuery(
    `insert into notifications (user_id, school_id, kind, title, body)
     select m.user_id, $1, 'welcome', 'خوش آمدید', 'حساب شما در سامانه پایش ۲ آماده است.' from memberships m where m.school_id = $1 and m.role = 'teacher'`,
    [school.id],
  );

  console.log(
    JSON.stringify({
      ok: true,
      schoolId: school.id,
      students: studentIds.length,
      demoPassword: password,
      accounts: ['admin', 'sysadmin', 'moaven', 'it', 'finance', 'counselor', 'teacher1..4', 'student1..36', 'guardian1..12'],
      note: 'همه داده‌ها ساختگی است.',
    }),
  );
  await closePool();
  await stopEmbeddedDatabase();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
});
