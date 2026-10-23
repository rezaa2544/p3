import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schoolTx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authOf, clientMeta, requirePerm } from '../lib/http.js';
import { assertTeacherAssigned, studentByUserId } from '../lib/scope.js';
import { parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';

async function studentClassIds(
  db: Parameters<typeof studentByUserId>[0],
  studentId: string,
): Promise<{ classId: string; yearId: string }[]> {
  return db.query<{ classId: string; yearId: string }>(
    `select e.class_id as "classId", e.academic_year_id as "yearId"
       from enrollments e where e.student_id = $1 and e.status = 'enrolled'`,
    [studentId],
  );
}

/** بررسی دسترسی مشاهده یک تکلیف بر اساس نقش و رابطه واقعی */
async function canViewAssignment(
  db: Parameters<typeof studentByUserId>[0],
  auth: ReturnType<typeof authOf>,
  assignmentId: string,
): Promise<{ id: string; class_id: string; teacher_user_id: string }> {
  const row = await db.one<{ id: string; class_id: string; teacher_user_id: string }>(
    `select a.id, ta.class_id, ta.teacher_user_id
       from assignments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
      where a.id = $1 and a.school_id = $2`,
    [assignmentId, auth.schoolId],
  );
  if (!row) throw notFound('تکلیف یافت نشد');
  if (auth.role === 'teacher' && row.teacher_user_id !== auth.userId) throw forbidden('این تکلیف متعلق به شما نیست');
  if (auth.role === 'student') {
    const st = await studentByUserId(db, auth.userId);
    if (!st) throw forbidden();
    const classes = await studentClassIds(db, st.id);
    if (!classes.some((c) => c.classId === row.class_id)) throw forbidden('این تکلیف برای کلاس شما نیست');
  }
  if (auth.role === 'guardian') {
    const rows = await db.query<{ n: number }>(
      `select count(*)::int as n from student_guardians g
         join enrollments e on e.student_id = g.student_id
        where g.guardian_user_id = $1 and e.class_id = $2 and e.status = 'enrolled'`,
      [auth.userId, row.class_id],
    );
    if ((rows[0]?.n ?? 0) === 0) throw forbidden('این تکلیف مربوط به فرزند شما نیست');
  }
  return row;
}

export function registerAssignmentRoutes(app: FastifyInstance): void {
  app.get('/assignments', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { classId?: string; upcoming?: string };
    return schoolTx(auth, async (db) => {
      const params: unknown[] = [auth.schoolId];
      let scopeSql = 'true';
      if (auth.role === 'teacher') {
        params.push(auth.userId);
        scopeSql = `ta.teacher_user_id = $${params.length}`;
      } else if (auth.role === 'student') {
        const st = await studentByUserId(db, auth.userId);
        if (!st) return { items: [] };
        const classes = await studentClassIds(db, st.id);
        params.push(classes.map((c) => c.classId));
        scopeSql = `ta.class_id = any($${params.length}::uuid[])`;
      } else if (auth.role === 'guardian') {
        params.push(auth.userId);
        scopeSql = `ta.class_id in (select e.class_id from student_guardians g join enrollments e on e.student_id = g.student_id
                                   where g.guardian_user_id = $${params.length})`;
      }
      if (qs.classId) {
        params.push(qs.classId);
        scopeSql += ` and ta.class_id = $${params.length}::uuid`;
      }
      if (qs.upcoming === 'true') scopeSql += ' and a.due_at > now()';
      const items = await db.query(
        `select a.id, a.title, a.description, a.due_at, a.published_at, a.allow_submission, a.max_score,
                c.title as class_title, s.title as subject_title, ta.class_id
           from assignments a
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
           join classes c on c.id = ta.class_id
           join subjects s on s.id = ta.subject_id
          where a.school_id = $1 and (a.published_at is not null or $${params.length + 1}::boolean) and ${scopeSql}
          order by a.due_at desc limit 200`,
        [...params, auth.role !== 'student' && auth.role !== 'guardian'],
      );
      return { items, serverTime: new Date().toISOString() };
    });
  });

  app.post('/assignments', async (req) => {
    const auth = requirePerm(req, 'assignments.manage');
    const body = parse(
      z.object({
        classId: uuid,
        subjectId: uuid,
        title: z.string().min(2).max(160),
        description: z.string().max(4000).optional(),
        dueAt: z.string().datetime(),
        maxScore: z.number().positive().max(100).nullish(),
        allowSubmission: z.boolean().default(true),
        publish: z.boolean().default(false),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      if (auth.role === 'teacher') await assertTeacherAssigned(db, auth.userId, body.classId, body.subjectId);
      const ta = await db.one<{ id: string; academic_year_id: string }>(
        `select ta.id, ta.academic_year_id from teaching_assignments ta
           join academic_years y on y.id = ta.academic_year_id and y.is_current
          where ta.class_id = $1 and ta.subject_id = $2 and ta.school_id = $3`,
        [body.classId, body.subjectId, auth.schoolId],
      );
      if (!ta) throw notFound('تخصیص دبیر برای این کلاس/درس یافت نشد');
      const created = await db.one(
        `insert into assignments (school_id, academic_year_id, teaching_assignment_id, title, description,
                                  due_at, max_score, allow_submission, published_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         returning id, title, due_at, published_at`,
        [
          auth.schoolId,
          ta.academic_year_id,
          ta.id,
          body.title,
          body.description ?? null,
          body.dueAt,
          body.maxScore ?? null,
          body.allowSubmission,
          body.publish ? new Date().toISOString() : null,
          auth.userId,
        ],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'assignment.create',
        entity: 'assignment',
        entityId: (created as { id?: string } | null)?.id ?? null,
        after: { title: body.title, publish: body.publish },
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.post('/assignments/:id/publish', async (req) => {
    const auth = requirePerm(req, 'assignments.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const row = await db.one<{ id: string; teacher_user_id: string }>(
        `select a.id, ta.teacher_user_id from assignments a
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
          where a.id = $1 and a.school_id = $2`,
        [id, auth.schoolId],
      );
      if (!row) throw notFound('تکلیف یافت نشد');
      if (auth.role === 'teacher' && row.teacher_user_id !== auth.userId) throw forbidden('این تکلیف متعلق به شما نیست');
      const updated = await db.one(
        'update assignments set published_at = coalesce(published_at, now()) where id = $1 returning id, published_at',
        [id],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'assignment.publish',
        entity: 'assignment',
        entityId: id,
        ...clientMeta(req),
      });
      return updated;
    });
  });

  app.post('/assignments/:id/submissions', async (req) => {
    const auth = authOf(req);
    if (auth.role !== 'student') throw forbidden('ارسال پاسخ فقط برای دانش‌آموز مجاز است');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ body: z.string().min(1).max(8000) }), req.body);
    return schoolTx(auth, async (db) => {
      const assignment = await canViewAssignment(db, auth, id);
      const detail = await db.one<{ due_at: string; allow_submission: boolean; published_at: string | null; class_id: string }>(
        `select a.due_at, a.allow_submission, a.published_at, ta.class_id
           from assignments a join teaching_assignments ta on ta.id = a.teaching_assignment_id where a.id = $1`,
        [assignment.id],
      );
      if (!detail) throw notFound('تکلیف یافت نشد');
      if (!detail.published_at) throw badRequest('این تکلیف هنوز منتشر نشده است');
      if (!detail.allow_submission) throw badRequest('ارسال پاسخ برای این تکلیف فعال نیست');
      const st = await studentByUserId(db, auth.userId);
      if (!st) throw forbidden();
      const late = new Date(detail.due_at).getTime() < Date.now();
      const created = await db.one(
        `insert into assignment_submissions (assignment_id, student_id, body, status)
         values ($1,$2,$3,$4)
         on conflict (assignment_id, student_id)
         do update set body = excluded.body, submitted_at = now(), status = excluded.status
         returning id, status, submitted_at`,
        [id, st.id, body.body, late ? 'late' : 'submitted'],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'submission.create',
        entity: 'assignment',
        entityId: id,
        after: { late },
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.get('/assignments/:id/submissions', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const row = await canViewAssignment(db, auth, id);
      if (auth.role === 'student' || auth.role === 'guardian') {
        const st = auth.role === 'student' ? await studentByUserId(db, auth.userId) : null;
        return {
          items: await db.query(
            `select s.id, s.status, s.submitted_at, s.score, s.feedback from assignment_submissions s
              where s.assignment_id = $1 and ($2::uuid is null or s.student_id = $2::uuid)`,
            [id, st?.id ?? null],
          ),
        };
      }
      if (auth.role === 'teacher' && row.teacher_user_id !== auth.userId) throw forbidden();
      return {
        items: await db.query(
          `select s.id, s.student_id, st.first_name, st.last_name, s.body, s.status, s.submitted_at, s.score, s.feedback
             from assignment_submissions s join students st on st.id = s.student_id
            where s.assignment_id = $1 order by st.last_name`,
          [id],
        ),
      };
    });
  });

  app.post('/submissions/:id/review', async (req) => {
    const auth = requirePerm(req, 'assignments.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({ score: z.number().min(0).nullish(), feedback: z.string().max(2000).optional() }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const row = await db.one<{ id: string; teacher_user_id: string; max_score: string | null }>(
        `select s.id, ta.teacher_user_id, a.max_score
           from assignment_submissions s
           join assignments a on a.id = s.assignment_id
           join teaching_assignments ta on ta.id = a.teaching_assignment_id
          where s.id = $1 and a.school_id = $2`,
        [id, auth.schoolId],
      );
      if (!row) throw notFound('پاسخ یافت نشد');
      if (auth.role === 'teacher' && row.teacher_user_id !== auth.userId) throw forbidden('این تکلیف متعلق به شما نیست');
      if (body.score != null && row.max_score && body.score > Number(row.max_score)) {
        throw badRequest('نمره بیشتر از سقف تکلیف است');
      }
      const updated = await db.one(
        `update assignment_submissions set score = $1, feedback = $2, status = 'reviewed', reviewed_by = $3
         where id = $4 returning id, status, score, feedback`,
        [body.score ?? null, body.feedback ?? null, auth.userId, id],
      );
      return updated;
    });
  });
}
