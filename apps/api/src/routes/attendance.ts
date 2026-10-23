import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schoolTx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { authOf, can, clientMeta, requirePerm, todayTehran } from '../lib/http.js';
import { idempotent } from '../lib/idempotency.js';
import { assertCanViewStudent, assertTeacherAssigned, guardianLink, studentByUserId } from '../lib/scope.js';
import { isoDate, parse, requireIdempotencyKey, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'early_leave', 'excused', 'sick'] as const;
const statusEnum = z.enum(ATTENDANCE_STATUSES);

const recordSchema = z.object({
  studentId: uuid,
  status: statusEnum,
  note: z.string().max(300).nullish(),
});

const batchSchema = z.object({
  classId: uuid,
  day: isoDate,
  periodNo: z.number().int().min(0).max(12).default(0),
  records: z.array(recordSchema).min(1).max(200),
  source: z.enum(['online', 'offline']).default('online'),
  capturedAt: z.string().datetime().nullish(),
});

const LATE_AFTER_MS = 24 * 60 * 60 * 1000;

export function registerAttendanceRoutes(app: FastifyInstance): void {
  app.post('/attendance', async (req, reply) => {
    const auth = requirePerm(req, 'attendance.write');
    const key = requireIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const body = parse(batchSchema, req.body);
    const meta = clientMeta(req);

    const out = await schoolTx(auth, async (db) => {
      const result = await idempotent(
        db,
        { key, userId: auth.userId, endpoint: 'POST /attendance', body },
        async () => {
          const cls = await db.one<{ id: string; academic_year_id: string }>(
            'select id, academic_year_id from classes where id = $1 and school_id = $2',
            [body.classId, auth.schoolId],
          );
          if (!cls) throw notFound('کلاس یافت نشد');

          if (auth.role === 'teacher') {
            await assertTeacherAssigned(db, auth.userId, body.classId);
          }

          const today = todayTehran();
          if (body.day > today) throw badRequest('ثبت حضور برای تاریخ آینده مجاز نیست');

          // همه دانش‌آموزان باید در همین کلاس و سال تحصیلی ثبت‌نام باشند
          const ids = body.records.map((r) => r.studentId);
          if (new Set(ids).size !== ids.length) throw badRequest('فهرست دانش‌آموزان تکراری است');
          const enrolled = await db.query<{ student_id: string }>(
            `select student_id from enrollments
              where class_id = $1 and academic_year_id = $2 and student_id = any($3::uuid[]) and status = 'enrolled'`,
            [body.classId, cls.academic_year_id, ids],
          );
          const enrolledSet = new Set(enrolled.map((r) => r.student_id));
          const missing = ids.filter((id) => !enrolledSet.has(id));
          if (missing.length) {
            throw badRequest('برخی دانش‌آموزان در این کلاس ثبت‌نام نیستند', { studentIds: missing });
          }

          const existing = await db.query<{ student_id: string; id: string }>(
            `select id, student_id from attendance_records
              where class_id = $1 and day = $2 and period_no = $3 and student_id = any($4::uuid[])`,
            [body.classId, body.day, body.periodNo, ids],
          );
          if (existing.length) {
            throw conflict('برای برخی دانش‌آموزان در این زنگ/روز قبلاً حضور ثبت شده است', {
              existing: existing.map((e) => ({ attendanceId: e.id, studentId: e.student_id })),
              hint: 'برای اصلاح از مسیر اصلاح با دلیل استفاده کنید',
            });
          }

          if (body.source === 'offline' && body.capturedAt) {
            const captured = new Date(body.capturedAt).getTime();
            if (Number.isFinite(captured) && Math.abs(Date.now() - captured) > LATE_AFTER_MS) {
              // ثبت آفلاین قدیمی‌تر از ۲۴ ساعت: پذیرش با علامت‌گذاری برای بررسی
              req.log.warn({ capturedAt: body.capturedAt }, 'offline attendance older than 24h');
            }
          }

          const rows = await db.query<{ id: string }>(
            `insert into attendance_records
               (school_id, academic_year_id, class_id, student_id, day, period_no, status, note,
                recorded_by, source, captured_at, client_op_id)
             select $1,$2,$3, x.student_id, $4, $5, x.status, x.note, $6, $7, $8::timestamptz, $9
               from unnest($10::uuid[], $11::text[], $12::text[]) as x(student_id, status, note)
             returning id`,
            [
              auth.schoolId,
              cls.academic_year_id,
              body.classId,
              body.day,
              body.periodNo,
              auth.userId,
              body.source,
              body.capturedAt ?? null,
              key,
              ids,
              body.records.map((r) => r.status),
              body.records.map((r) => r.note ?? null),
            ],
          );

          const absentStudents = body.records.filter((r) => r.status === 'absent' || r.status === 'late').map((r) => r.studentId);
          if (absentStudents.length) {
            await db.query(
              `insert into outbox_jobs (kind, payload) values ('notify_guardians_attendance', $1)`,
              [
                JSON.stringify({
                  schoolId: auth.schoolId,
                  classId: body.classId,
                  day: body.day,
                  periodNo: body.periodNo,
                  students: absentStudents,
                }),
              ],
            );
          }

          await audit(db, {
            schoolId: auth.schoolId,
            actorUserId: auth.userId,
            actorRole: auth.role,
            action: 'attendance.record',
            entity: 'attendance',
            entityId: body.classId,
            after: { day: body.day, periodNo: body.periodNo, count: rows.length, source: body.source },
            ...meta,
          });

          return {
            statusCode: 201,
            body: {
              ok: true,
              saved: rows.length,
              day: body.day,
              periodNo: body.periodNo,
              ids: rows.map((r) => r.id),
              serverTime: new Date().toISOString(),
            },
          };
        },
      );
      return result;
    });

    reply.status(out.statusCode);
    if (out.replayed) reply.header('Idempotent-Replayed', 'true');
    return out.body;
  });

  app.get('/attendance', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { classId?: string; day?: string; studentId?: string; from?: string; to?: string };
    return schoolTx(auth, async (db) => {
      if (qs.studentId) {
        await assertCanViewStudent(db, auth, qs.studentId);
        if (auth.role === 'guardian') {
          const link = await guardianLink(db, auth.userId, qs.studentId);
          if (!link?.can_view_attendance) throw forbidden('اجازه مشاهده حضور این دانش‌آموز به شما داده نشده است');
        }
      }
      if (qs.classId && auth.role === 'teacher') {
        await assertTeacherAssigned(db, auth.userId, qs.classId);
      }
      if (qs.classId) {
        const cls = await db.query('select id from classes where id = $1 and school_id = $2', [qs.classId, auth.schoolId]);
        if (!cls[0]) throw notFound('کلاس یافت نشد');
      }
      const items = await db.query(
        `select a.id, a.student_id, s.first_name, s.last_name, a.day::text as day, a.period_no, a.status, a.note,
                a.source, a.recorded_at, a.captured_at, u.full_name as recorded_by_name
           from attendance_records a
           join students s on s.id = a.student_id
           join users u on u.id = a.recorded_by
          where a.school_id = $1
            and ($2::uuid is null or a.class_id = $2::uuid)
            and ($3::uuid is null or a.student_id = $3::uuid)
            and ($4::date is null or a.day = $4::date)
            and ($5::date is null or a.day >= $5::date)
            and ($6::date is null or a.day <= $6::date)
          order by a.day desc, a.period_no, s.last_name
          limit 2000`,
        [
          auth.schoolId,
          qs.classId ?? null,
          qs.studentId ?? null,
          qs.day ?? null,
          qs.from ?? null,
          qs.to ?? null,
        ],
      );
      return { items };
    });
  });

  app.put('/attendance/:id', async (req) => {
    const auth = requirePerm(req, 'attendance.correct');
    const { id } = parse(z.object({ id: uuid }), req.params);
    const body = parse(
      z.object({ status: statusEnum, reason: z.string().min(5).max(300) }),
      req.body,
    );
    return schoolTx(auth, async (db) => {
      const current = await db.one<{ id: string; status: string; student_id: string; class_id: string; day: string }>(
        'select id, status, student_id, class_id, day from attendance_records where id = $1 and school_id = $2',
        [id, auth.schoolId],
      );
      if (!current) throw notFound('رکورد حضور یافت نشد');
      if (current.status === body.status) throw badRequest('وضعیت جدید با وضعیت فعلی یکسان است');
      const updated = await db.one(
        `update attendance_records set status = $1, updated_at = now() where id = $2
         returning id, status, updated_at`,
        [body.status, id],
      );
      await db.query(
        `insert into attendance_revisions (record_id, changed_by, old_status, new_status, reason)
         values ($1,$2,$3,$4,$5)`,
        [id, auth.userId, current.status, body.status, body.reason],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'attendance.correct',
        entity: 'attendance',
        entityId: id,
        before: { status: current.status },
        after: { status: body.status, reason: body.reason },
        ...clientMeta(req),
      });
      return updated;
    });
  });

  app.get('/attendance/:id/revisions', async (req) => {
    const auth = requirePerm(req, 'attendance.read');
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const record = await db.one<{ id: string; student_id: string }>(
        'select id, student_id from attendance_records where id = $1 and school_id = $2',
        [id, auth.schoolId],
      );
      if (!record) throw notFound('رکورد حضور یافت نشد');
      await assertCanViewStudent(db, auth, record.student_id);
      const items = await db.query(
        `select r.id, r.old_status, r.new_status, r.reason, r.changed_at, u.full_name as changed_by_name
           from attendance_revisions r
           join users u on u.id = r.changed_by
          where r.record_id = $1
          order by r.changed_at desc`,
        [id],
      );
      return { items };
    });
  });

  app.get('/attendance/report', async (req) => {
    const auth = requirePerm(req, 'attendance.read');
    const qs = req.query as { from?: string; to?: string; classId?: string };
    if (!qs.from || !qs.to) throw badRequest('بازه تاریخ (from و to) الزامی است');
    return schoolTx(auth, async (db) => {
      if (qs.classId && auth.role === 'teacher') await assertTeacherAssigned(db, auth.userId, qs.classId);
      const items = await db.query(
        `select s.id as student_id, s.first_name, s.last_name, c.title as class_title,
                count(*) filter (where a.status = 'present')::int as present,
                count(*) filter (where a.status = 'absent')::int as absent,
                count(*) filter (where a.status = 'late')::int as late,
                count(*) filter (where a.status = 'early_leave')::int as early_leave,
                count(*) filter (where a.status = 'excused')::int as excused,
                count(*) filter (where a.status = 'sick')::int as sick,
                count(*)::int as total
           from attendance_records a
           join students s on s.id = a.student_id
           left join enrollments e on e.student_id = s.id and e.academic_year_id = a.academic_year_id
           left join classes c on c.id = e.class_id
          where a.school_id = $1 and a.day between $2 and $3
            and ($4::uuid is null or a.class_id = $4::uuid)
          group by s.id, s.first_name, s.last_name, c.title
          order by absent desc, late desc, s.last_name`,
        [auth.schoolId, qs.from, qs.to, qs.classId ?? null],
      );
      return { items, range: { from: qs.from, to: qs.to } };
    });
  });

  app.get('/me/attendance', async (req) => {
    const auth = authOf(req);
    const qs = req.query as { from?: string; to?: string };
    return schoolTx(auth, async (db) => {
      let studentId: string | undefined;
      if (auth.role === 'student') {
        const st = await studentByUserId(db, auth.userId);
        studentId = st?.id;
      } else if (auth.role === 'guardian') {
        const qs2 = req.query as { studentId?: string };
        if (!qs2.studentId) throw badRequest('studentId الزامی است');
        const link = await guardianLink(db, auth.userId, qs2.studentId);
        if (!link?.can_view_attendance) throw forbidden('اجازه مشاهده حضور داده نشده است');
        studentId = qs2.studentId;
      } else {
        throw forbidden('این مسیر برای دانش‌آموز/ولی است');
      }
      if (!studentId) throw notFound('پرونده دانش‌آموزی یافت نشد');
      if (!can(auth, 'attendance.read')) throw forbidden();
      const items = await db.query(
        `select id, day::text as day, period_no, status, note from attendance_records
          where school_id = $1 and student_id = $2
            and ($3::date is null or day >= $3::date) and ($4::date is null or day <= $4::date)
          order by day desc, period_no limit 500`,
        [auth.schoolId, studentId, qs.from ?? null, qs.to ?? null],
      );
      return { items, studentId };
    });
  });
}
