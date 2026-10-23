import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schoolTx, type Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authOf, clientMeta, requirePerm, todayTehran } from '../lib/http.js';
import { guardianLink, studentByUserId, visibleStudentIds, type AuthContext } from '../lib/scope.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';

const ATTENDANCE_LABEL: Record<string, string> = {
  present: 'حاضر',
  absent: 'غایب',
  late: 'تأخیر',
  early_leave: 'خروج زودهنگام',
  excused: 'موجه',
  sick: 'بیمار',
};

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  // BOM برای نمایش صحیح فارسی در Excel
  return '\uFEFF' + lines.join('\r\n');
}

async function teacherDashboard(db: Db, auth: AuthContext) {
  const today = todayTehran();
  const classes = await db.query<{ class_id: string; class_title: string; subject_title: string; period_no: number | null }>(
    `select distinct ta.class_id, c.title as class_title, s.title as subject_title,
            t.period_no
       from teaching_assignments ta
       join academic_years y on y.id = ta.academic_year_id and y.is_current
       join classes c on c.id = ta.class_id
       join subjects s on s.id = ta.subject_id
       left join timetable t on t.class_id = ta.class_id and t.period_no is not null
       and t.weekday = extract(dow from $2::date)
      where ta.teacher_user_id = $1 and ta.school_id = $3
      order by t.period_no nulls last`,
    [auth.userId, today, auth.schoolId],
  );
  const pending = await db.query<{ class_id: string; class_title: string; period_no: number }>(
    `select c.id as class_id, c.title as class_title, coalesce(t.period_no, 0) as period_no
       from teaching_assignments ta
       join academic_years y on y.id = ta.academic_year_id and y.is_current
       join classes c on c.id = ta.class_id
       left join timetable t on t.class_id = c.id and t.weekday = extract(dow from $2::date)
      where ta.teacher_user_id = $1 and ta.school_id = $3
        and not exists (
          select 1 from attendance_records a
           where a.class_id = c.id and a.day = $2::date
             and a.period_no = coalesce(t.period_no, 0)
        )
      order by c.title`,
    [auth.userId, today, auth.schoolId],
  );
  const drafts = await db.query<{ n: number }>(
    `select count(*)::int as n from assessments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
      where ta.teacher_user_id = $1 and a.school_id = $2 and a.status = 'draft'`,
    [auth.userId, auth.schoolId],
  );
  const assignments = await db.query(
    `select a.id, a.title, a.due_at, c.title as class_title
       from assignments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
       join classes c on c.id = ta.class_id
      where ta.teacher_user_id = $1 and a.school_id = $2 and a.published_at is not null and a.due_at > now()
      order by a.due_at limit 5`,
    [auth.userId, auth.schoolId],
  );
  return {
    role: 'teacher',
    date: today,
    classesToday: classes,
    pendingAttendance: pending,
    pendingAttendanceCount: pending.length,
    draftAssessments: drafts[0]?.n ?? 0,
    upcomingAssignments: assignments,
  };
}

async function adminDashboard(db: Db, auth: AuthContext) {
  const today = todayTehran();
  const stats = await db.one<{
    students: number;
    active_students: number;
    classes: number;
    staff: number;
    teachers: number;
  }>(
    `select
       (select count(*)::int from students where school_id = $1) as students,
       (select count(*)::int from students where school_id = $1 and status = 'active') as active_students,
       (select count(*)::int from classes where school_id = $1 and is_active) as classes,
       (select count(*)::int from memberships where school_id = $1 and role not in ('student','guardian')) as staff,
       (select count(*)::int from memberships where school_id = $1 and role = 'teacher') as teachers`,
    [auth.schoolId],
  );
  const attendance = await db.query<{ status: string; n: number }>(
    `select status, count(*)::int as n from attendance_records
      where school_id = $1 and day = $2 group by status`,
    [auth.schoolId, today],
  );
  const attendanceTotal = attendance.reduce((s, r) => s + r.n, 0);
  const gradesPending = await db.one<{ n: number }>(
    `select count(*)::int as n from grades g join assessments a on a.id = g.assessment_id
      where a.school_id = $1 and g.status = 'submitted'`,
    [auth.schoolId],
  );
  const absentToday = await db.one<{ n: number }>(
    `select count(distinct student_id)::int as n from attendance_records
      where school_id = $1 and day = $2 and status = 'absent'`,
    [auth.schoolId, today],
  );
  const recentAudit = await db.query(
    `select a.id, a.action, a.entity, a.created_at, u.full_name as actor_name
       from audit_log a left join users u on u.id = a.actor_user_id
      where a.school_id = $1 order by a.id desc limit 8`,
    [auth.schoolId],
  );
  const classesWithoutAttendance = await db.query<{ id: string; title: string }>(
    `select c.id, c.title from classes c
      join academic_years y on y.id = c.academic_year_id and y.is_current
     where c.school_id = $1 and c.is_active
       and not exists (select 1 from attendance_records a where a.class_id = c.id and a.day = $2)
     order by c.title limit 20`,
    [auth.schoolId, today],
  );
  return {
    role: auth.role,
    date: today,
    stats: {
      ...stats,
      attendanceRecordedToday: attendanceTotal,
      attendanceByStatus: attendance.map((r) => ({ status: r.status, label: ATTENDANCE_LABEL[r.status] ?? r.status, count: r.n })),
      absentStudentsToday: absentToday?.n ?? 0,
      gradesPendingApproval: gradesPending?.n ?? 0,
      hasAttendanceDataToday: attendanceTotal > 0,
    },
    classesWithoutAttendanceToday: classesWithoutAttendance,
    recentActivity: recentAudit,
  };
}

export function registerReportRoutes(app: FastifyInstance): void {
  app.get('/dashboard', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => {
      if (auth.role === 'teacher') return teacherDashboard(db, auth);
      if (auth.role === 'student') {
        const st = await studentByUserId(db, auth.userId);
        if (!st) return { role: 'student', enrolled: false, upcomingAssignments: [], notifications: 0 };
        const upcoming = await db.query(
          `select a.id, a.title, a.due_at, s.title as subject_title
             from assignments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
             join subjects s on s.id = ta.subject_id
             join enrollments e on e.class_id = ta.class_id and e.academic_year_id = ta.academic_year_id
            where e.student_id = $1 and a.published_at is not null and a.due_at > now()
            order by a.due_at limit 10`,
          [st.id],
        );
        const unread = await db.one<{ n: number }>(
          'select count(*)::int as n from notifications where user_id = $1 and read_at is null',
          [auth.userId],
        );
        return { role: 'student', enrolled: true, upcomingAssignments: upcoming, unreadNotifications: unread?.n ?? 0 };
      }
      if (auth.role === 'guardian') {
        const children = await db.query<{ id: string; first_name: string; last_name: string; class_title: string | null }>(
          `select s.id, s.first_name, s.last_name, c.title as class_title
             from student_guardians g join students s on s.id = g.student_id
             left join enrollments e on e.student_id = s.id and e.academic_year_id =
                  (select id from academic_years where school_id = s.school_id and is_current limit 1)
             left join classes c on c.id = e.class_id
            where g.guardian_user_id = $1 and s.school_id = $2 order by s.last_name`,
          [auth.userId, auth.schoolId],
        );
        const attendance = await db.query<{ student_id: string; status: string; n: number }>(
          `select student_id, status, count(*)::int as n from attendance_records
            where school_id = $1 and student_id = any($2::uuid[]) and day >= current_date - 30
            group by student_id, status`,
          [auth.schoolId, children.map((c) => c.id)],
        );
        const unread = await db.one<{ n: number }>(
          'select count(*)::int as n from notifications where user_id = $1 and read_at is null',
          [auth.userId],
        );
        return { role: 'guardian', children, attendanceLast30Days: attendance, unreadNotifications: unread?.n ?? 0 };
      }
      if (!auth.permissions.has('reports.read') && !auth.permissions.has('school.read')) throw forbidden();
      return adminDashboard(db, auth);
    });
  });

  app.get('/reports/attendance', async (req) => {
    const auth = requirePerm(req, 'reports.read');
    const qs = parse(
      z.object({ from: isoDate, to: isoDate, classId: uuid.optional() }),
      req.query,
    );
    return schoolTx(auth, async (db) => {
      if (auth.role === 'teacher') {
        const teacherRows = await db.query<{ n: number }>(
          `select count(*)::int as n from teaching_assignments ta
             join academic_years y on y.id = ta.academic_year_id and y.is_current
            where ta.teacher_user_id = $1 and ta.school_id = $2`,
          [auth.userId, auth.schoolId],
        );
        if ((teacherRows[0]?.n ?? 0) === 0) throw forbidden('شما کلاس فعالی ندارید');
      }
      const daily = await db.query<{ day: string; status: string; n: number }>(
        `select day::text, status, count(*)::int as n
           from attendance_records
          where school_id = $1 and day between $2 and $3 and ($4::uuid is null or class_id = $4::uuid)
          group by day, status order by day`,
        [auth.schoolId, qs.from, qs.to, qs.classId ?? null],
      );
      const perClass = await db.query(
        `select c.id, c.title,
                count(a.id)::int as records,
                count(*) filter (where a.status = 'absent')::int as absent,
                count(*) filter (where a.status = 'late')::int as late,
                count(*) filter (where a.status = 'present')::int as present
           from classes c
           left join attendance_records a on a.class_id = c.id and a.day between $2 and $3
          where c.school_id = $1 and ($4::uuid is null or c.id = $4::uuid)
          group by c.id, c.title order by c.title`,
        [auth.schoolId, qs.from, qs.to, qs.classId ?? null],
      );
      const atRisk = await db.query(
        `select s.id as student_id, s.first_name, s.last_name,
                count(*) filter (where a.status = 'absent')::int as absences,
                count(*) filter (where a.status = 'late')::int as lates
           from attendance_records a join students s on s.id = a.student_id
          where a.school_id = $1 and a.day between $2 and $3 and ($4::uuid is null or a.class_id = $4::uuid)
          group by s.id, s.first_name, s.last_name
         having count(*) filter (where a.status = 'absent') >= 3 or count(*) filter (where a.status = 'late') >= 3
          order by absences desc, lates desc limit 100`,
        [auth.schoolId, qs.from, qs.to, qs.classId ?? null],
      );
      return { range: qs, daily, perClass, atRisk, hasData: daily.length > 0 };
    });
  });

  app.get('/reports/grades', async (req) => {
    const auth = requirePerm(req, 'reports.read');
    const qs = parse(z.object({ termId: uuid.optional(), classId: uuid.optional() }), req.query);
    return schoolTx(auth, async (db) => {
      const items = await db.query(
        `select s.id as subject_id, s.title as subject_title, c.title as class_title, c.id as class_id,
                count(g.id) filter (where g.status = 'approved' and g.score is not null)::int as graded,
                round(avg((g.score / a.max_score) * 20) filter (where g.status = 'approved' and g.score is not null), 2)::float as average,
                count(g.id) filter (where g.status = 'submitted')::int as pending
           from assessments a
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
           join subjects s on s.id = ta.subject_id
           join classes c on c.id = ta.class_id
           left join grades g on g.assessment_id = a.id
          where a.school_id = $1
            and ($2::uuid is null or a.term_id = $2::uuid)
            and ($3::uuid is null or ta.class_id = $3::uuid)
          group by s.id, s.title, c.id, c.title
          order by c.title, s.title`,
        [auth.schoolId, qs.termId ?? null, qs.classId ?? null],
      );
      return { items, hasData: items.some((i) => (i as { graded: number }).graded > 0) };
    });
  });

  app.get('/reports/overview', async (req) => {
    const auth = requirePerm(req, 'reports.read');
    const qs = parse(z.object({ from: isoDate, to: isoDate }), req.query);
    return schoolTx(auth, async (db) => {
      const attendance = await db.one<{ total: number; absent: number; late: number }>(
        `select count(*)::int as total,
                count(*) filter (where status = 'absent')::int as absent,
                count(*) filter (where status = 'late')::int as late
           from attendance_records where school_id = $1 and day between $2 and $3`,
        [auth.schoolId, qs.from, qs.to],
      );
      const grades = await db.one<{ approved: number; pending: number; average: number | null }>(
        `select count(*) filter (where g.status = 'approved')::int as approved,
                count(*) filter (where g.status = 'submitted')::int as pending,
                round(avg((g.score / a.max_score) * 20) filter (where g.status = 'approved' and g.score is not null), 2)::float as average
           from grades g join assessments a on a.id = g.assessment_id
          where a.school_id = $1`,
        [auth.schoolId],
      );
      const assignments = await db.one<{ active: number; overdue: number }>(
        `select count(*) filter (where due_at > now())::int as active,
                count(*) filter (where due_at <= now())::int as overdue
           from assignments where school_id = $1 and published_at is not null`,
        [auth.schoolId],
      );
      return {
        range: qs,
        attendance: attendance ?? { total: 0, absent: 0, late: 0 },
        grades: grades ?? { approved: 0, pending: 0, average: null },
        assignments: assignments ?? { active: 0, overdue: 0 },
        hasData: (attendance?.total ?? 0) > 0 || (grades?.approved ?? 0) > 0,
      };
    });
  });

  app.get('/reports/attendance.csv', async (req, reply) => {
    const auth = requirePerm(req, 'reports.read');
    const qs = parse(z.object({ from: isoDate, to: isoDate, classId: uuid.optional() }), req.query);
    const csv = await schoolTx(auth, async (db) => {
      const rows = await db.query<{
        day: string;
        first_name: string;
        last_name: string;
        class_title: string | null;
        status: string;
        note: string | null;
        recorded_at: string;
      }>(
        `select a.day::text, s.first_name, s.last_name, c.title as class_title, a.status, a.note, a.recorded_at::text
           from attendance_records a
           join students s on s.id = a.student_id
           left join enrollments e on e.student_id = s.id and e.academic_year_id = a.academic_year_id
           left join classes c on c.id = e.class_id
          where a.school_id = $1 and a.day between $2 and $3 and ($4::uuid is null or a.class_id = $4::uuid)
          order by a.day, a.period_no, s.last_name limit 20000`,
        [auth.schoolId, qs.from, qs.to, qs.classId ?? null],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'report.export',
        entity: 'attendance',
        after: { from: qs.from, to: qs.to, classId: qs.classId ?? null, rows: rows.length },
        ...clientMeta(req),
      });
      return toCsv(
        ['تاریخ', 'نام', 'نام خانوادگی', 'کلاس', 'وضعیت', 'یادداشت', 'زمان ثبت'],
        rows.map((r) => [r.day, r.first_name, r.last_name, r.class_title, ATTENDANCE_LABEL[r.status] ?? r.status, r.note, r.recorded_at]),
      );
    });
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="attendance-${qs.from}_${qs.to}.csv"`);
    return csv;
  });

  app.get('/meta/options', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => {
      const classes = await db.query(
        `select c.id, c.title from classes c join academic_years y on y.id = c.academic_year_id and y.is_current
          where c.school_id = $1 and c.is_active order by c.title`,
        [auth.schoolId],
      );
      const subjects = await db.query('select id, title, code from subjects where school_id = $1 order by title', [
        auth.schoolId,
      ]);
      const terms = await db.query(
        `select t.id, t.title, t.academic_year_id from terms t
           join academic_years y on y.id = t.academic_year_id
          where y.school_id = $1 and y.is_current order by t.seq`,
        [auth.schoolId],
      );
      const attendanceStatuses = Object.entries(ATTENDANCE_LABEL).map(([value, label]) => ({ value, label }));
      return { classes, subjects, terms, attendanceStatuses, today: todayTehran() };
    });
  });

  app.get('/students/:id/summary', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const visible = await visibleStudentIds(db, auth);
      if (visible !== 'all' && !visible.includes(id)) throw forbidden('دسترسی به این دانش‌آموز مجاز نیست');
      if (auth.role === 'guardian') {
        const link = await guardianLink(db, auth.userId, id);
        if (!link) throw forbidden('این دانش‌آموز فرزند شما نیست');
      }
      const student = await db.one('select id, first_name, last_name, status from students where id = $1 and school_id = $2', [
        id,
        auth.schoolId,
      ]);
      if (!student) throw notFound('دانش‌آموز یافت نشد');
      const attendance = await db.query<{ status: string; n: number }>(
        `select status, count(*)::int as n from attendance_records
          where school_id = $1 and student_id = $2 and day >= current_date - 90 group by status`,
        [auth.schoolId, id],
      );
      const grades = await db.query(
        `select s.title as subject_title, round(avg((g.score / a.max_score) * 20), 2)::float as average, count(*)::int as count
           from grades g join assessments a on a.id = g.assessment_id
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
           join subjects s on s.id = ta.subject_id
          where g.student_id = $1 and g.status = 'approved' and g.score is not null and ta.school_id = $2
          group by s.title order by s.title`,
        [id, auth.schoolId],
      );
      return { student, attendance, grades, hasGrades: grades.length > 0, hasAttendance: attendance.length > 0 };
    });
  });
}

export { badRequest, todayTehran };
