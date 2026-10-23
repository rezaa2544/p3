import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schoolTx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authOf, can, clientMeta, requirePerm } from '../lib/http.js';
import { assertCanViewStudent, assertTeacherAssigned, guardianLink, studentByUserId } from '../lib/scope.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';
import { computeSubjectAverage, describeAverage, type AssessmentScore } from '../services/grading.js';

const KIND = z.enum(['quiz', 'midterm', 'final', 'oral', 'project', 'other']);

async function teacherOwnsAssessment(
  db: Parameters<typeof assertTeacherAssigned>[0],
  teacherId: string,
  assessmentId: string,
): Promise<{ id: string; class_id: string; subject_id: string; status: string; max_score: number }> {
  const row = await db.one<{ id: string; class_id: string; subject_id: string; status: string; max_score: number }>(
    `select a.id, ta.class_id, ta.subject_id, a.status, a.max_score
       from assessments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
      where a.id = $1 and ta.teacher_user_id = $2`,
    [assessmentId, teacherId],
  );
  if (!row) throw notFound('ارزیابی یافت نشد یا به شما تخصیص ندارد');
  return row;
}

async function canViewStudentGrades(
  db: Parameters<typeof assertCanViewStudent>[0],
  auth: ReturnType<typeof authOf>,
  studentId: string,
): Promise<void> {
  await assertCanViewStudent(db, auth, studentId);
  if (auth.role === 'guardian') {
    const link = await guardianLink(db, auth.userId, studentId);
    if (!link?.can_view_grades) throw forbidden('اجازه مشاهده نمرات این دانش‌آموز به شما داده نشده است');
  }
}

export function registerGradeRoutes(app: FastifyInstance): void {
  app.get('/assessments', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { classId?: string; subjectId?: string; termId?: string };
    return schoolTx(auth, async (db) => {
      if (qs.classId && auth.role === 'teacher') await assertTeacherAssigned(db, auth.userId, qs.classId);
      return {
        items: await db.query(
          `select a.id, a.title, a.kind, a.max_score, a.weight, a.held_on, a.status,
                  a.teaching_assignment_id, ta.class_id, c.title as class_title,
                  ta.subject_id, s.title as subject_title, ta.teacher_user_id,
                  (select count(*)::int from grades g where g.assessment_id = a.id) as grade_count
             from assessments a
             join teaching_assignments ta on ta.id = a.teaching_assignment_id
             join classes c on c.id = ta.class_id
             join subjects s on s.id = ta.subject_id
            where a.school_id = $1
              and ($2::uuid is null or ta.class_id = $2::uuid)
              and ($3::uuid is null or ta.subject_id = $3::uuid)
              and ($4::uuid is null or a.term_id = $4::uuid)
              and ($5::text <> 'teacher' or ta.teacher_user_id = $6::uuid)
            order by a.created_at desc limit 500`,
          [auth.schoolId, qs.classId ?? null, qs.subjectId ?? null, qs.termId ?? null, auth.role, auth.userId],
        ),
      };
    });
  });

  app.post('/assessments', async (req) => {
    const auth = requirePerm(req, 'grades.write');
    const body = parse(
      z.object({
        classId: uuid,
        subjectId: uuid,
        termId: uuid,
        title: z.string().min(1).max(120),
        kind: KIND,
        maxScore: z.number().positive().max(100).default(20),
        weight: z.number().positive().max(10).default(1),
        heldOn: isoDate.nullish(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      if (auth.role === 'teacher') await assertTeacherAssigned(db, auth.userId, body.classId, body.subjectId);
      const ta = await db.one<{ id: string }>(
        `select ta.id from teaching_assignments ta
           join academic_years y on y.id = ta.academic_year_id and y.is_current
          where ta.class_id = $1 and ta.subject_id = $2 and ta.school_id = $3`,
        [body.classId, body.subjectId, auth.schoolId],
      );
      if (!ta) throw notFound('تخصیص دبیر برای این کلاس/درس یافت نشد');
      const term = await db.query('select id from terms where id = $1', [body.termId]);
      if (!term[0]) throw notFound('دوره ارزیابی یافت نشد');
      const created = await db.one(
        `insert into assessments (school_id, academic_year_id, term_id, teaching_assignment_id, title, kind, max_score, weight, held_on, created_by)
         select $1, ta.academic_year_id, $2, ta.id, $3, $4, $5, $6, $7, $8
           from teaching_assignments ta where ta.id = $9
         returning id, title, status, max_score, weight`,
        [
          auth.schoolId,
          body.termId,
          body.title,
          body.kind,
          body.maxScore,
          body.weight,
          body.heldOn ?? null,
          auth.userId,
          ta.id,
        ],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'assessment.create',
        entity: 'assessment',
        entityId: (created as { id?: string } | null)?.id ?? null,
        after: { title: body.title, kind: body.kind },
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.get('/assessments/:id/grades', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      if (auth.role === 'teacher') await teacherOwnsAssessment(db, auth.userId, id);
      const items = await db.query(
        `select g.id, g.student_id, s.first_name, s.last_name, g.score, g.status, g.updated_at
           from grades g join students s on s.id = g.student_id
          where g.assessment_id = $1
          order by s.last_name, s.first_name`,
        [id],
      );
      return { items };
    });
  });

  app.post('/assessments/:id/grades', async (req) => {
    const auth = requirePerm(req, 'grades.write');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({
        grades: z
          .array(z.object({ studentId: uuid, score: z.number().min(0).nullish() }))
          .min(1)
          .max(200),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const assessment = await db.one<{ id: string; max_score: string; class_id: string; academic_year_id: string; status: string }>(
        `select a.id, a.max_score, ta.class_id, ta.academic_year_id, a.status
           from assessments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
          where a.id = $1 and a.school_id = $2`,
        [id, auth.schoolId],
      );
      if (!assessment) throw notFound('ارزیابی یافت نشد');
      if (auth.role === 'teacher') await assertTeacherAssigned(db, auth.userId, assessment.class_id);
      if (assessment.status === 'closed') throw forbidden('ارزیابی بسته شده است');
      const maxScore = Number(assessment.max_score);
      const ids = body.grades.map((g) => g.studentId);
      const enrolled = await db.query<{ student_id: string }>(
        `select student_id from enrollments where class_id = $1 and academic_year_id = $2
          and student_id = any($3::uuid[]) and status = 'enrolled'`,
        [assessment.class_id, assessment.academic_year_id, ids],
      );
      const enrolledSet = new Set(enrolled.map((r) => r.student_id));
      const invalid = ids.filter((sid) => !enrolledSet.has(sid));
      if (invalid.length) throw badRequest('برخی دانش‌آموزان عضو این کلاس نیستند', { studentIds: invalid });
      for (const g of body.grades) {
        if (g.score !== null && g.score !== undefined && (g.score < 0 || g.score > maxScore)) {
          throw badRequest(`نمره باید بین ۰ و ${maxScore} باشد`);
        }
      }
      // نمره تأییدشده با این مسیر قابل بازنویسی نیست
      const approved = await db.query<{ id: string }>(
        `select id from grades where assessment_id = $1 and status = 'approved' and student_id = any($2::uuid[])`,
        [id, ids],
      );
      if (approved.length) throw forbidden('نمره تأییدشده قابل تغییر از این مسیر نیست');

      const rows = await db.query(
        `insert into grades (assessment_id, student_id, score, status, entered_by)
         select $1, x.student_id, x.score, 'submitted', $2
           from unnest($3::uuid[], $4::numeric[]) as x(student_id, score)
         on conflict (assessment_id, student_id)
         do update set score = excluded.score, status = 'submitted', entered_by = excluded.entered_by, updated_at = now()
         returning id, student_id, score, status`,
        [id, auth.userId, ids, body.grades.map((g) => g.score ?? null)],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'grades.enter',
        entity: 'assessment',
        entityId: id,
        after: { count: rows.length },
        ...clientMeta(req),
      });
      return { ok: true, saved: rows.length, items: rows };
    });
  });

  app.post('/assessments/:id/approve', async (req) => {
    const auth = requirePerm(req, 'grades.approve');
    const { id } = parse(z.object({ id: uuid }), req.params);
    parse(z.object({ confirm: z.boolean().optional() }).optional(), req.body ?? {});
    return schoolTx(auth, async (db) => {
      const assessment = await db.query<{ id: string; status: string }>(
        "select id, status from assessments where id = $1 and school_id = $2 and status <> 'closed'",
        [id, auth.schoolId],
      );
      if (!assessment[0]) throw notFound('ارزیابی یافت نشد یا بسته شده است');
      const updated = await db.query(
        `update grades set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now()
          where assessment_id = $1 and status = 'submitted'
          returning id`,
        [id, auth.userId],
      );
      await db.query("update assessments set status = 'published' where id = $1", [id]);
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'grades.approve',
        entity: 'assessment',
        entityId: id,
        after: { approved: updated.length },
        ...clientMeta(req),
      });
      return { ok: true, approved: updated.length };
    });
  });

  app.put('/grades/:id', async (req) => {
    const auth = authOf(req);
    if (!can(auth, 'grades.write') && !can(auth, 'grades.approve')) throw forbidden('مجوز ویرایش نمره ندارید');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({ score: z.number().min(0).nullish(), reason: z.string().min(5).max(300) }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const current = await db.one<{ id: string; score: string | null; status: string; max_score: string; assessment_id: string }>(
        `select g.id, g.score, g.status, a.max_score, g.assessment_id
           from grades g join assessments a on a.id = g.assessment_id
          where g.id = $1 and a.school_id = $2`,
        [id, auth.schoolId],
      );
      if (!current) throw notFound('نمره یافت نشد');
      if (current.score !== null && body.score !== null && body.score !== undefined && Number(current.score) === body.score) {
        throw badRequest('نمره جدید با نمره فعلی یکسان است');
      }
      if (body.score !== null && body.score !== undefined && body.score > Number(current.max_score)) {
        throw badRequest(`نمره باید حداکثر ${current.max_score} باشد`);
      }
      let nextStatus = current.status;
      if (current.status === 'approved') {
        if (!can(auth, 'grades.approve')) throw forbidden('تغییر نمره تأییدشده فقط با مجوز مدیر/معاون مجاز است');
        nextStatus = 'submitted';
      }
      const updated = await db.one(
        `update grades set score = $1, status = $2, updated_at = now() where id = $3
         returning id, score, status, updated_at`,
        [body.score ?? null, nextStatus, id],
      );
      await db.query(
        `insert into grade_revisions (grade_id, changed_by, old_score, new_score, old_status, new_status, reason)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, auth.userId, current.score, body.score ?? null, current.status, nextStatus, body.reason],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'grade.update',
        entity: 'grade',
        entityId: id,
        before: { score: current.score, status: current.status },
        after: { score: body.score ?? null, status: nextStatus, reason: body.reason },
        ...clientMeta(req),
      });
      return updated;
    });
  });

  app.get('/grades', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { studentId?: string; assessmentId?: string; termId?: string };
    return schoolTx(auth, async (db) => {
      if (!qs.studentId) throw badRequest('studentId الزامی است');
      await canViewStudentGrades(db, auth, qs.studentId);
      const items = await db.query(
        `select g.id, g.assessment_id, g.score, g.status, a.title, a.kind, a.max_score, a.weight,
                a.held_on, s.title as subject_title, s.id as subject_id
           from grades g
           join assessments a on a.id = g.assessment_id
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
           join subjects s on s.id = ta.subject_id
          where ta.school_id = $1 and g.student_id = $2
            and ($3::uuid is null or a.term_id = $3::uuid)
            and ($4::boolean or g.status = 'approved')
          order by s.title, a.held_on nulls last, a.created_at`,
        [auth.schoolId, qs.studentId, qs.termId ?? null, can(auth, 'grades.write') || can(auth, 'grades.approve')],
      );
      return { items };
    });
  });

  app.get('/report-card', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { studentId?: string; termId?: string; yearId?: string };
    if (!qs.studentId) throw badRequest('studentId الزامی است');
    const studentId = qs.studentId;
    return schoolTx(auth, async (db) => {
      await canViewStudentGrades(db, auth, studentId);
      const student = await db.one<{ id: string; first_name: string; last_name: string }>(
        'select id, first_name, last_name from students where id = $1 and school_id = $2',
        [studentId, auth.schoolId],
      );
      if (!student) throw notFound('دانش‌آموز یافت نشد');
      const rows = await db.query<{
        subject_id: string;
        subject_title: string;
        assessment_id: string;
        title: string;
        max_score: string;
        weight: string;
        score: string | null;
        status: string | null;
        approved: boolean | null;
      }>(
        `select s.id as subject_id, s.title as subject_title, a.id as assessment_id, a.title,
                a.max_score, a.weight, g.score, g.status,
                (g.status = 'approved') as approved
           from enrollments e
           join teaching_assignments ta on ta.class_id = e.class_id and ta.academic_year_id = e.academic_year_id
           join subjects s on s.id = ta.subject_id
           join assessments a on a.teaching_assignment_id = ta.id
           left join grades g on g.assessment_id = a.id and g.student_id = $2
          where ta.school_id = $1 and e.student_id = $2
            and a.status <> 'draft'
            and ($3::uuid is null or a.term_id = $3::uuid)
            and ($4::uuid is null or ta.academic_year_id = $4::uuid)
          order by s.title, a.held_on nulls last, a.created_at`,
        [auth.schoolId, studentId, qs.termId ?? null, qs.yearId ?? null],
      );
      const bySubject = new Map<string, { title: string; items: AssessmentScore[] }>();
      for (const r of rows) {
        const entry = bySubject.get(r.subject_id) ?? { title: r.subject_title, items: [] };
        entry.items.push({
          id: r.assessment_id,
          title: r.title,
          maxScore: Number(r.max_score),
          weight: Number(r.weight),
          score: r.score === null ? null : Number(r.score),
          status: r.status ?? 'pending',
          approved: r.approved === true,
        });
        bySubject.set(r.subject_id, entry);
      }
      const subjects = [...bySubject.entries()].map(([subjectId, v]) => {
        const avg = computeSubjectAverage(v.items);
        return { subjectId, subjectTitle: v.title, ...avg, result: describeAverage(avg), assessments: v.items };
      });
      const graded = subjects.filter((s) => s.average !== null);
      const overall =
        graded.length > 0
          ? Math.round((graded.reduce((sum, s) => sum + (s.average ?? 0), 0) / graded.length) * 100) / 100
          : null;
      return {
        student,
        subjects,
        overall: {
          average: overall,
          hasData: graded.length > 0,
          complete: subjects.length > 0 && subjects.every((s) => s.complete),
          subjectsWithData: graded.length,
          subjectsTotal: subjects.length,
        },
        dataNotice:
          graded.length === 0
            ? 'داده کافی برای محاسبه کارنامه وجود ندارد'
            : subjects.some((s) => !s.complete)
              ? 'برخی نمرات ناقص یا تأییدنشده‌اند؛ میانگین ممکن است تغییر کند'
              : null,
      };
    });
  });

  app.get('/me/grades', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => {
      let studentId: string | null = null;
      if (auth.role === 'student') {
        const st = await studentByUserId(db, auth.userId);
        studentId = st?.id ?? null;
      } else if (auth.role === 'guardian') {
        const qs = req.query as { studentId?: string };
        if (!qs.studentId) throw badRequest('studentId الزامی است');
        const link = await guardianLink(db, auth.userId, qs.studentId);
        if (!link?.can_view_grades) throw forbidden('اجازه مشاهده نمرات داده نشده است');
        studentId = qs.studentId;
      } else {
        throw forbidden('این مسیر برای دانش‌آموز/ولی است');
      }
      if (!studentId) throw notFound('پرونده دانش‌آموزی یافت نشد');
      const items = await db.query(
        `select g.score, g.status, a.title, a.max_score, s.title as subject_title
           from grades g join assessments a on a.id = g.assessment_id
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
           join subjects s on s.id = ta.subject_id
          where g.student_id = $1 and g.status = 'approved' and ta.school_id = $2
          order by s.title`,
        [studentId, auth.schoolId],
      );
      return { items, studentId };
    });
  });
}
