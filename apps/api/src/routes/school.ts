import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { globalQuery, schoolTx } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { authOf, clientMeta, pageParams, requirePerm } from '../lib/http.js';
import { assertClassInSchool, requireCurrentYear } from '../lib/scope.js';
import { isoDate, parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';

export function registerSchoolRoutes(app: FastifyInstance): void {
  app.get('/schools', async (req) => {
    const auth = authOf(req);
    if (auth.isSuperAdmin) {
      const rows = await globalQuery<{ id: string; name: string; code: string }>(
        'select id, name, code from schools where is_active order by name',
      );
      return { items: rows };
    }
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select s.id, s.name, s.code from memberships m join schools s on s.id = m.school_id
          where m.user_id = $1 and s.is_active order by s.name`,
        [auth.userId],
      ),
    }));
  });

  app.get('/school', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => {
      const school = await db.one(
        `select id, name, code, city, timezone, settings, created_at from schools where id = $1`,
        [auth.schoolId],
      );
      if (!school) throw notFound('مدرسه یافت نشد');
      const year = await db.one(
        'select id, title, starts_on, ends_on from academic_years where school_id = $1 and is_current limit 1',
        [auth.schoolId],
      );
      return { school, currentYear: year };
    });
  });

  app.patch('/school', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({
        name: z.string().min(2).max(120).optional(),
        city: z.string().max(80).optional(),
        timezone: z.string().max(60).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const before = await db.one('select name, city, timezone, settings from schools where id = $1', [auth.schoolId]);
      const updated = await db.one(
        `update schools set
           name = coalesce($2, name),
           city = coalesce($3, city),
           timezone = coalesce($4, timezone),
           settings = coalesce($5::jsonb, settings)
         where id = $1
         returning id, name, city, timezone, settings`,
        [
          auth.schoolId,
          body.name ?? null,
          body.city ?? null,
          body.timezone ?? null,
          body.settings ? JSON.stringify(body.settings) : null,
        ],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'school.update',
        entity: 'school',
        entityId: auth.schoolId,
        before,
        after: updated,
        ...clientMeta(req),
      });
      return updated;
    });
  });

  app.get('/academic-years', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select y.id, y.title, y.starts_on, y.ends_on, y.is_current,
                (select count(*)::int from enrollments e where e.academic_year_id = y.id) as enrollments
           from academic_years y where y.school_id = $1 order by y.starts_on desc`,
        [auth.schoolId],
      ),
    }));
  });

  app.post('/academic-years', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({ title: z.string().min(4).max(40), startsOn: isoDate, endsOn: isoDate, makeCurrent: z.boolean().default(false) }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const created = await db.one<{ id: string }>(
        `insert into academic_years (school_id, title, starts_on, ends_on, is_current)
         values ($1,$2,$3,$4,false) returning id, title, starts_on, ends_on, is_current`,
        [auth.schoolId, body.title, body.startsOn, body.endsOn],
      );
      if (body.makeCurrent && created) {
        await db.query('update academic_years set is_current = false where school_id = $1', [auth.schoolId]);
        await db.query('update academic_years set is_current = true where id = $1', [created.id]);
      }
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'academic_year.create',
        entity: 'academic_year',
        entityId: created?.id ?? null,
        after: created,
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.post('/academic-years/:id/activate', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const rows = await db.query('select id from academic_years where id = $1 and school_id = $2', [id, auth.schoolId]);
      if (!rows[0]) throw notFound('سال تحصیلی یافت نشد');
      await db.query('update academic_years set is_current = (id = $1) where school_id = $2', [id, auth.schoolId]);
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'academic_year.activate',
        entity: 'academic_year',
        entityId: id,
        ...clientMeta(req),
      });
      return { ok: true, activeYearId: id };
    });
  });

  app.get('/terms', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { yearId?: string };
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select t.id, t.title, t.seq, t.starts_on, t.ends_on, t.academic_year_id
           from terms t join academic_years y on y.id = t.academic_year_id
          where y.school_id = $1 and ($2::uuid is null or t.academic_year_id = $2::uuid)
          order by t.seq`,
        [auth.schoolId, qs.yearId ?? null],
      ),
    }));
  });

  app.post('/terms', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({ academicYearId: uuid, title: z.string().min(1).max(40), seq: z.number().int().min(1).max(6), startsOn: isoDate, endsOn: isoDate }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const year = await db.query('select id from academic_years where id = $1 and school_id = $2', [body.academicYearId, auth.schoolId]);
      if (!year[0]) throw notFound('سال تحصیلی یافت نشد');
      return db.one(
        `insert into terms (academic_year_id, title, seq, starts_on, ends_on)
         values ($1,$2,$3,$4,$5) returning id, title, seq, starts_on, ends_on`,
        [body.academicYearId, body.title, body.seq, body.startsOn, body.endsOn],
      );
    });
  });

  app.get('/grade-levels', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => ({
      items: await db.query('select id, title, seq from grade_levels where school_id = $1 order by seq', [auth.schoolId]),
    }));
  });

  app.post('/grade-levels', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(z.object({ title: z.string().min(1).max(40), seq: z.number().int().min(1).max(30) }), req.body);
    return schoolTx(auth, async (db) =>
      db.one(
        'insert into grade_levels (school_id, title, seq) values ($1,$2,$3) returning id, title, seq',
        [auth.schoolId, body.title, body.seq],
      ),
    );
  });

  app.get('/classes', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { yearId?: string };
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select c.id, c.title, c.capacity, c.is_active, c.academic_year_id, g.title as grade_level,
                (select count(*)::int from enrollments e where e.class_id = c.id and e.status = 'enrolled') as students
           from classes c left join grade_levels g on g.id = c.grade_level_id
          where c.school_id = $1 and ($2::uuid is null or c.academic_year_id = $2::uuid)
          order by c.title`,
        [auth.schoolId, qs.yearId ?? null],
      ),
    }));
  });

  app.post('/classes', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({
        academicYearId: uuid.optional(),
        title: z.string().min(1).max(40),
        gradeLevelId: uuid.nullish(),
        capacity: z.number().int().min(1).max(100).optional(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const yearId = body.academicYearId ?? (await requireCurrentYear(db, auth.schoolId));
      return db.one(
        `insert into classes (school_id, academic_year_id, grade_level_id, title, capacity)
         values ($1,$2,$3,$4,$5) returning id, title, academic_year_id, grade_level_id, capacity`,
        [auth.schoolId, yearId, body.gradeLevelId ?? null, body.title, body.capacity ?? null],
      );
    });
  });

  app.get('/subjects', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => ({
      items: await db.query('select id, title, code, weekly_hours from subjects where school_id = $1 order by title', [
        auth.schoolId,
      ]),
    }));
  });

  app.post('/subjects', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({ title: z.string().min(1).max(80), code: z.string().min(1).max(20), weeklyHours: z.number().int().min(0).max(20).optional() }),
      req.body,
    );
    return schoolTx(auth, async (db) =>
      db.one(
        'insert into subjects (school_id, title, code, weekly_hours) values ($1,$2,$3,$4) returning id, title, code',
        [auth.schoolId, body.title, body.code, body.weeklyHours ?? null],
      ),
    );
  });

  app.get('/teaching-assignments', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { teacherId?: string; classId?: string };
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select ta.id, ta.class_id, c.title as class_title, ta.subject_id, s.title as subject_title,
                ta.teacher_user_id, u.full_name as teacher_name, ta.academic_year_id
           from teaching_assignments ta
           join classes c on c.id = ta.class_id
           join subjects s on s.id = ta.subject_id
           join users u on u.id = ta.teacher_user_id
          where ta.school_id = $1
            and ($2::uuid is null or ta.teacher_user_id = $2::uuid)
            and ($3::uuid is null or ta.class_id = $3::uuid)
          order by c.title, s.title`,
        [auth.schoolId, qs.teacherId ?? null, qs.classId ?? null],
      ),
    }));
  });

  app.post('/teaching-assignments', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({ classId: uuid, subjectId: uuid, teacherUserId: uuid }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const cls = await assertClassInSchool(db, body.classId, auth.schoolId);
      const teacher = await db.query<{ id: string }>(
        `select m.user_id as id from memberships m
          where m.user_id = $1 and m.school_id = $2 and m.role = 'teacher'`,
        [body.teacherUserId, auth.schoolId],
      );
      if (!teacher[0]) throw badRequest('کاربر انتخاب‌شده دبیر این مدرسه نیست');
      const subject = await db.query('select id from subjects where id = $1 and school_id = $2', [
        body.subjectId,
        auth.schoolId,
      ]);
      if (!subject[0]) throw notFound('درس یافت نشد');
      const created = await db.one(
        `insert into teaching_assignments (school_id, academic_year_id, class_id, subject_id, teacher_user_id)
         values ($1,$2,$3,$4,$5) returning id, class_id, subject_id, teacher_user_id`,
        [auth.schoolId, cls.academic_year_id, body.classId, body.subjectId, body.teacherUserId],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'teaching_assignment.create',
        entity: 'teaching_assignment',
        entityId: (created as { id?: string } | null)?.id ?? null,
        after: created,
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.get('/timetable', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { classId?: string };
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select t.id, t.class_id, t.weekday, t.period_no, t.subject_id, s.title as subject_title,
                t.teacher_user_id, u.full_name as teacher_name, t.room
           from timetable t
           join subjects s on s.id = t.subject_id
           left join users u on u.id = t.teacher_user_id
          where t.school_id = $1 and ($2::uuid is null or t.class_id = $2::uuid)
          order by t.weekday, t.period_no`,
        [auth.schoolId, qs.classId ?? null],
      ),
      bells: await db.query('select period_no, starts_at, ends_at from bell_periods where school_id = $1 order by period_no', [
        auth.schoolId,
      ]),
    }));
  });

  app.post('/timetable', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({
        classId: uuid,
        weekday: z.number().int().min(0).max(6),
        periodNo: z.number().int().min(1).max(12),
        subjectId: uuid,
        teacherUserId: uuid.nullish(),
        room: z.string().max(40).nullish(),
      }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const cls = await assertClassInSchool(db, body.classId, auth.schoolId);
      return db.one(
        `insert into timetable (school_id, academic_year_id, class_id, weekday, period_no, subject_id, teacher_user_id, room)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (class_id, academic_year_id, weekday, period_no)
         do update set subject_id = excluded.subject_id, teacher_user_id = excluded.teacher_user_id, room = excluded.room
         returning id, class_id, weekday, period_no, subject_id`,
        [auth.schoolId, cls.academic_year_id, body.classId, body.weekday, body.periodNo, body.subjectId, body.teacherUserId ?? null, body.room ?? null],
      );
    });
  });

  app.get('/calendar', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        'select id, day, kind, title from calendar_days where school_id = $1 order by day',
        [auth.schoolId],
      ),
    }));
  });

  app.post('/calendar', async (req) => {
    const auth = requirePerm(req, 'school.manage');
    const body = parse(
      z.object({ day: isoDate, kind: z.enum(['holiday', 'exam', 'event', 'compensatory']), title: z.string().min(1).max(120) }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const yearId = await requireCurrentYear(db, auth.schoolId);
      return db.one(
        `insert into calendar_days (school_id, academic_year_id, day, kind, title)
         values ($1,$2,$3,$4,$5)
         on conflict (school_id, day) do update set kind = excluded.kind, title = excluded.title
         returning id, day, kind, title`,
        [auth.schoolId, yearId, body.day, body.kind, body.title],
      );
    });
  });

  app.get('/audit', async (req) => {
    const auth = requirePerm(req, 'audit.read');
    const { limit, offset } = pageParams(req, 50, 200);
    const qs = req.query as { action?: string; entity?: string; from?: string; to?: string };
    return schoolTx(auth, async (db) => {
      const items = await db.query(
        `select a.id, a.created_at, a.action, a.entity, a.entity_id, a.actor_user_id,
                u.full_name as actor_name, a.actor_role, a.ip, a.request_id
           from audit_log a left join users u on u.id = a.actor_user_id
          where a.school_id = $1
            and ($2::text is null or a.action = $2)
            and ($3::text is null or a.entity = $3)
            and ($4::date is null or a.created_at >= $4::date)
            and ($5::date is null or a.created_at < ($5::date + 1))
          order by a.id desc limit $6 offset $7`,
        [auth.schoolId, qs.action ?? null, qs.entity ?? null, qs.from ?? null, qs.to ?? null, limit, offset],
      );
      const total = await db.one<{ n: number }>(
        'select count(*)::int as n from audit_log where school_id = $1',
        [auth.schoolId],
      );
      return { items, total: total?.n ?? 0, page: Math.floor(offset / limit) + 1, limit };
    });
  });
}
