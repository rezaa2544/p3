import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schoolTx, type Db } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authOf, can, clientMeta, pageParams, requirePerm } from '../lib/http.js';
import { assertCanViewStudent, studentByUserId, visibleStudentIds, type AuthContext } from '../lib/scope.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';
import { hashPassword } from '../security/password.js';
import { newToken } from '../security/password.js';
import { revokeAllSessions } from '../security/session.js';

const ROLES = z.enum([
  'org_admin',
  'school_admin',
  'vice_principal',
  'it_operator',
  'teacher',
  'counselor',
  'finance',
  'student',
  'guardian',
]);

/** نقش‌هایی که هر بازیگر می‌تواند تخصیص دهد (جلوگیری از ارتقای سطح دسترسی) */
const ASSIGNABLE: Record<string, string[]> = {
  school_admin: ['school_admin', 'vice_principal', 'it_operator', 'teacher', 'counselor', 'finance', 'student', 'guardian'],
  org_admin: ['school_admin', 'vice_principal', 'it_operator', 'teacher', 'counselor', 'finance', 'student', 'guardian'],
  it_operator: ['teacher', 'counselor', 'finance', 'student', 'guardian'],
};

function tempPassword(): string {
  return `P2-${newToken(9)}`;
}

async function studentRowAccess(db: Db, auth: AuthContext, studentId: string) {
  await assertCanViewStudent(db, auth, studentId);
  const row = await db.one(
    `select s.id, s.first_name, s.last_name, s.gender, s.birth_date, s.status, s.user_id,
            e.class_id, c.title as class_title, e.academic_year_id
       from students s
       left join enrollments e on e.student_id = s.id and e.academic_year_id =
            (select id from academic_years where school_id = s.school_id and is_current limit 1)
       left join classes c on c.id = e.class_id
      where s.id = $1`,
    [studentId],
  );
  return row;
}

export function registerPeopleRoutes(app: FastifyInstance): void {
  app.get('/students', async (req) => {
    const auth = requirePerm(req, 'students.read');
    const { limit, offset } = pageParams(req);
    const qs = req.query as { search?: string; classId?: string; status?: string };
    return schoolTx(auth, async (db) => {
      const visible = await visibleStudentIds(db, auth);
      if (visible !== 'all' && visible.length === 0) return { items: [], total: 0, page: 1, limit };
      const ids = visible === 'all' ? null : visible;
      const rows = await db.query(
        `select s.id, s.first_name, s.last_name, s.status,
                e.class_id, c.title as class_title
           from students s
           left join enrollments e on e.student_id = s.id and e.academic_year_id =
                (select id from academic_years where school_id = s.school_id and is_current limit 1)
           left join classes c on c.id = e.class_id
          where s.school_id = $1
            and ($2::uuid[] is null or s.id = any($2::uuid[]))
            and ($3::text is null or (s.first_name || ' ' || s.last_name) ilike '%' || $3 || '%')
            and ($4::uuid is null or e.class_id = $4::uuid)
            and ($5::text is null or s.status = $5)
          order by s.last_name, s.first_name
          limit $6 offset $7`,
        [auth.schoolId, ids, qs.search ?? null, qs.classId ?? null, qs.status ?? null, limit, offset],
      );
      const total = await db.one<{ n: number }>(
        `select count(*)::int as n from students s
          left join enrollments e on e.student_id = s.id and e.academic_year_id =
            (select id from academic_years where school_id = s.school_id and is_current limit 1)
         where s.school_id = $1
           and ($2::uuid[] is null or s.id = any($2::uuid[]))
           and ($3::text is null or (s.first_name || ' ' || s.last_name) ilike '%' || $3 || '%')
           and ($4::uuid is null or e.class_id = $4::uuid)
           and ($5::text is null or s.status = $5)`,
        [auth.schoolId, ids, qs.search ?? null, qs.classId ?? null, qs.status ?? null],
      );
      return { items: rows, total: total?.n ?? 0, page: Math.floor(offset / limit) + 1, limit };
    });
  });

  app.get('/students/:id', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const student = await studentRowAccess(db, auth, id);
      if (!student) throw notFound('دانش‌آموز یافت نشد');
      const guardians = can(auth, 'students.manage')
        ? await db.query(
            `select g.id, g.guardian_user_id, u.full_name, u.phone, g.relation, g.is_primary,
                    g.can_view_grades, g.can_view_attendance
               from student_guardians g join users u on u.id = g.guardian_user_id
              where g.student_id = $1`,
            [id],
          )
        : [];
      return { student, guardians };
    });
  });

  app.post('/students', async (req) => {
    const auth = requirePerm(req, 'students.manage');
    const body = parse(
      z.object({
        firstName: z.string().min(1).max(60),
        lastName: z.string().min(1).max(60),
        nationalId: z.string().regex(/^\d{10}$/).nullish(),
        birthDate: isoDate.nullish(),
        gender: z.enum(['male', 'female']).nullish(),
        classId: uuid.nullish(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const created = await db.one<{ id: string }>(
        `insert into students (school_id, first_name, last_name, national_id, birth_date, gender)
         values ($1,$2,$3,$4,$5,$6) returning id, first_name, last_name`,
        [
          auth.schoolId,
          body.firstName,
          body.lastName,
          body.nationalId ?? null,
          body.birthDate ?? null,
          body.gender ?? null,
        ],
      );
      if (body.classId && created) {
        const cls = await db.one<{ academic_year_id: string }>(
          'select academic_year_id from classes where id = $1 and school_id = $2',
          [body.classId, auth.schoolId],
        );
        if (!cls) throw notFound('کلاس یافت نشد');
        await db.query(
          `insert into enrollments (student_id, academic_year_id, class_id) values ($1,$2,$3)`,
          [created.id, cls.academic_year_id, body.classId],
        );
      }
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'student.create',
        entity: 'student',
        entityId: created?.id ?? null,
        after: { firstName: body.firstName, lastName: body.lastName, classId: body.classId ?? null },
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.patch('/students/:id', async (req) => {
    const auth = requirePerm(req, 'students.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({
        firstName: z.string().min(1).max(60).optional(),
        lastName: z.string().min(1).max(60).optional(),
        status: z.enum(['active', 'inactive', 'graduated', 'transferred']).optional(),
        birthDate: isoDate.nullish(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const before = await db.one('select id, first_name, last_name, status from students where id = $1 and school_id = $2', [
        id,
        auth.schoolId,
      ]);
      if (!before) throw notFound('دانش‌آموز یافت نشد');
      const after = await db.one(
        `update students set
           first_name = coalesce($3, first_name),
           last_name = coalesce($4, last_name),
           status = coalesce($5, status),
           birth_date = coalesce($6::date, birth_date),
           updated_at = now()
         where id = $1 and school_id = $2
         returning id, first_name, last_name, status`,
        [id, auth.schoolId, body.firstName ?? null, body.lastName ?? null, body.status ?? null, body.birthDate ?? null],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'student.update',
        entity: 'student',
        entityId: id,
        before,
        after,
        ...clientMeta(req),
      });
      return after;
    });
  });

  app.post('/students/:id/enroll', async (req) => {
    const auth = requirePerm(req, 'students.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(z.object({ classId: uuid }), req.body);
    return schoolTx(auth, async (db) => {
      const student = await db.query('select id from students where id = $1 and school_id = $2', [id, auth.schoolId]);
      if (!student[0]) throw notFound('دانش‌آموز یافت نشد');
      const cls = await db.one<{ academic_year_id: string }>(
        'select academic_year_id from classes where id = $1 and school_id = $2',
        [body.classId, auth.schoolId],
      );
      if (!cls) throw notFound('کلاس یافت نشد');
      const enrollment = await db.one(
        `insert into enrollments (student_id, academic_year_id, class_id)
         values ($1,$2,$3)
         on conflict (student_id, academic_year_id)
         do update set class_id = excluded.class_id, status = 'enrolled'
         returning id, student_id, class_id, academic_year_id, status`,
        [id, cls.academic_year_id, body.classId],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'student.enroll',
        entity: 'enrollment',
        entityId: id,
        after: enrollment,
        ...clientMeta(req),
      });
      return enrollment;
    });
  });

  app.post('/students/:id/guardians', async (req) => {
    const auth = requirePerm(req, 'users.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({
        guardianUserId: uuid,
        relation: z.enum(['father', 'mother', 'other']),
        isPrimary: z.boolean().default(false),
        canViewGrades: z.boolean().default(true),
        canViewAttendance: z.boolean().default(true),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const student = await db.query('select id from students where id = $1 and school_id = $2', [id, auth.schoolId]);
      if (!student[0]) throw notFound('دانش‌آموز یافت نشد');
      const membership = await db.query(
        `select user_id from memberships where user_id = $1 and school_id = $2 and role = 'guardian'`,
        [body.guardianUserId, auth.schoolId],
      );
      if (!membership[0]) throw badRequest('کاربر انتخاب‌شده ولی مجاز این مدرسه نیست');
      const link = await db.one(
        `insert into student_guardians (student_id, guardian_user_id, relation, is_primary, can_view_grades, can_view_attendance)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (student_id, guardian_user_id) do update
           set relation = excluded.relation, is_primary = excluded.is_primary,
               can_view_grades = excluded.can_view_grades, can_view_attendance = excluded.can_view_attendance
         returning id, student_id, guardian_user_id, relation, is_primary`,
        [id, body.guardianUserId, body.relation, body.isPrimary, body.canViewGrades, body.canViewAttendance],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'guardian.link',
        entity: 'student_guardian',
        entityId: id,
        after: { guardianUserId: body.guardianUserId, relation: body.relation },
        ...clientMeta(req),
      });
      return link;
    });
  });

  app.delete('/students/:studentId/guardians/:linkId', async (req) => {
    const auth = requirePerm(req, 'users.manage');
    const params = parse(z.object({ studentId: uuid, linkId: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const rows = await db.query(
        `delete from student_guardians g using students s
          where g.id = $1 and g.student_id = $2 and s.id = g.student_id and s.school_id = $3
          returning g.id`,
        [params.linkId, params.studentId, auth.schoolId],
      );
      if (!rows[0]) throw notFound('پیوند ولی یافت نشد');
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'guardian.unlink',
        entity: 'student_guardian',
        entityId: params.linkId,
        ...clientMeta(req),
      });
      return { ok: true };
    });
  });

  app.get('/me/children', async (req) => {
    const auth = authOf(req);
    if (auth.role !== 'guardian') throw forbidden('این مسیر مخصوص ولی است');
    return schoolTx(auth, async (db) => {
      return {
        items: await db.query(
          `select s.id, s.first_name, s.last_name, g.relation,
                  e.class_id, c.title as class_title
             from student_guardians g
             join students s on s.id = g.student_id
             left join enrollments e on e.student_id = s.id and e.academic_year_id =
                  (select id from academic_years where school_id = s.school_id and is_current limit 1)
             left join classes c on c.id = e.class_id
            where g.guardian_user_id = $1 and s.school_id = $2
            order by s.last_name`,
          [auth.userId, auth.schoolId],
        ),
      };
    });
  });

  app.get('/me/student', async (req) => {
    const auth = authOf(req);
    if (auth.role !== 'student') throw forbidden('این مسیر مخصوص دانش‌آموز است');
    return schoolTx(auth, async (db) => {
      const st = await studentByUserId(db, auth.userId);
      if (!st) throw notFound('پرونده دانش‌آموزی برای این حساب ثبت نشده است');
      return studentRowAccess(db, auth, st.id);
    });
  });

  app.get('/users', async (req) => {
    const auth = requirePerm(req, 'users.read');
    const { limit, offset } = pageParams(req);
    const qs = req.query as { role?: string; search?: string; active?: string };
    return schoolTx(auth, async (db) => {
      const items = await db.query(
        `select u.id, u.username, u.full_name, u.is_active, u.must_change_password, u.mfa_enabled,
                u.last_login_at, m.role
           from memberships m join users u on u.id = m.user_id
          where m.school_id = $1
            and ($2::text is null or m.role = $2)
            and ($3::text is null or u.full_name ilike '%' || $3 || '%' or u.username ilike '%' || $3 || '%')
            and ($4::text is null or u.is_active = ($4 = 'true'))
          order by u.full_name
          limit $5 offset $6`,
        [auth.schoolId, qs.role ?? null, qs.search ?? null, qs.active ?? null, limit, offset],
      );
      const total = await db.one<{ n: number }>(
        `select count(*)::int as n from memberships m join users u on u.id = m.user_id
          where m.school_id = $1 and ($2::text is null or m.role = $2)`,
        [auth.schoolId, qs.role ?? null],
      );
      return { items, total: total?.n ?? 0, page: Math.floor(offset / limit) + 1, limit };
    });
  });

  app.post('/users', async (req) => {
    const auth = requirePerm(req, 'users.manage');
    const body = parse(
      z.object({
        username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'نام کاربری فقط حروف لاتین، رقم و . _ -'),
        fullName: z.string().min(2).max(120),
        email: z.string().email().max(120).nullish(),
        phone: z.string().max(20).nullish(),
        role: ROLES,
        password: z.string().min(10).max(200).optional(),
      }),
      req.body,
    );
    const allowed = ASSIGNABLE[auth.role] ?? (auth.isSuperAdmin ? ASSIGNABLE.school_admin! : []);
    if (!allowed.includes(body.role)) throw forbidden('شما مجاز به تخصیص این نقش نیستید');

    const generated = body.password ?? tempPassword();
    const hash = await hashPassword(generated);
    const result = await schoolTx(auth, async (db) => {
      const created = await db.one<{ id: string }>(
        `insert into users (username, email, password_hash, full_name, phone, must_change_password)
         values ($1,$2,$3,$4,$5,true) returning id, username, full_name`,
        [body.username.toLowerCase(), body.email ?? null, hash, body.fullName, body.phone ?? null],
      );
      if (!created) throw badRequest('ایجاد کاربر ناموفق بود');
      await db.query('insert into memberships (user_id, school_id, role) values ($1,$2,$3)', [
        created.id,
        auth.schoolId,
        body.role,
      ]);
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'user.create',
        entity: 'user',
        entityId: created.id,
        after: { username: body.username, role: body.role },
        ...clientMeta(req),
      });
      return created;
    });
    return { ...result, role: body.role, temporaryPassword: body.password ? undefined : generated };
  });

  app.patch('/users/:id', async (req) => {
    const auth = requirePerm(req, 'users.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({
        fullName: z.string().min(2).max(120).optional(),
        isActive: z.boolean().optional(),
        role: ROLES.optional(),
        phone: z.string().max(20).nullish(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const target = await db.one<{ user_id: string; role: string; is_active: boolean }>(
        `select m.user_id, m.role, u.is_active from memberships m join users u on u.id = m.user_id
          where m.user_id = $1 and m.school_id = $2`,
        [id, auth.schoolId],
      );
      if (!target) throw notFound('کاربر در این مدرسه یافت نشد');
      if (target.user_id === auth.userId && body.isActive === false) throw badRequest('غیرفعال‌سازی حساب خودتان مجاز نیست');
      if (body.role) {
        const allowed = ASSIGNABLE[auth.role] ?? (auth.isSuperAdmin ? ASSIGNABLE.school_admin! : []);
        if (!allowed.includes(body.role)) throw forbidden('شما مجاز به تخصیص این نقش نیستید');
        await db.query('update memberships set role = $1 where user_id = $2 and school_id = $3', [
          body.role,
          id,
          auth.schoolId,
        ]);
      }
      const updated = await db.one(
        `update users set
           full_name = coalesce($2, full_name),
           is_active = coalesce($3, is_active),
           phone = coalesce($4, phone),
           updated_at = now()
         where id = $1 returning id, username, full_name, is_active`,
        [id, body.fullName ?? null, body.isActive ?? null, body.phone ?? null],
      );
      if (body.isActive === false) await revokeAllSessions(id);
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'user.update',
        entity: 'user',
        entityId: id,
        before: target,
        after: { isActive: body.isActive, role: body.role },
        ...clientMeta(req),
      });
      return updated;
    });
  });

  app.post('/users/:id/reset-password', async (req) => {
    const auth = requirePerm(req, 'users.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const target = await schoolTx(auth, async (db) =>
      db.one<{ user_id: string; role: string }>(
        'select user_id, role from memberships where user_id = $1 and school_id = $2',
        [id, auth.schoolId],
      ),
    );
    if (!target) throw notFound('کاربر در این مدرسه یافت نشد');
    if (target.role === 'school_admin' && auth.role !== 'school_admin' && !auth.isSuperAdmin) {
      throw forbidden('بازنشانی رمز مدیر مدرسه فقط توسط مدیر مدرسه مجاز است');
    }
    const password = tempPassword();
    await schoolTx(auth, async (db) => {
      await db.query('update users set password_hash = $1, must_change_password = true where id = $2', [
        await hashPassword(password),
        id,
      ]);
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'user.reset_password',
        entity: 'user',
        entityId: id,
        ...clientMeta(req),
      });
    });
    await revokeAllSessions(id);
    return { ok: true, temporaryPassword: password };
  });

  app.delete('/users/:id/memberships', async (req) => {
    const auth = requirePerm(req, 'users.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    if (id === auth.userId) throw badRequest('حذف عضویت خودتان مجاز نیست');
    return schoolTx(auth, async (db) => {
      const rows = await db.query(
        'delete from memberships where user_id = $1 and school_id = $2 returning user_id, role',
        [id, auth.schoolId],
      );
      if (!rows[0]) throw notFound('عضویت یافت نشد');
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'membership.delete',
        entity: 'membership',
        entityId: id,
        ...clientMeta(req),
      });
      return { ok: true };
    });
  });
}
