import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schoolTx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authOf, clientMeta, pageParams, requirePerm } from '../lib/http.js';
import { studentByUserId } from '../lib/scope.js';
import { parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';

export function registerCommsRoutes(app: FastifyInstance): void {
  app.get('/announcements', async (req) => {
    const auth = authOf(req);
    const { limit, offset } = pageParams(req, 30, 100);
    return schoolTx(auth, async (db) => {
      let classIds: string[] = [];
      if (auth.role === 'student') {
        const st = await studentByUserId(db, auth.userId);
        if (st) {
          const rows = await db.query<{ class_id: string }>(
            `select e.class_id from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_current
              where e.student_id = $1`,
            [st.id],
          );
          classIds = rows.map((r) => r.class_id);
        }
      } else if (auth.role === 'guardian') {
        const rows = await db.query<{ class_id: string }>(
          `select distinct e.class_id from student_guardians g
             join enrollments e on e.student_id = g.student_id
             join academic_years y on y.id = e.academic_year_id and y.is_current
            where g.guardian_user_id = $1`,
          [auth.userId],
        );
        classIds = rows.map((r) => r.class_id);
      }
      const items = await db.query(
        `select a.id, a.title, a.body, a.audience, a.target_class_id, a.target_role, a.published_at, a.created_at,
                u.full_name as created_by_name,
                exists(select 1 from announcement_reads r where r.announcement_id = a.id and r.user_id = $2) as is_read
           from announcements a join users u on u.id = a.created_by
          where a.school_id = $1 and a.published_at is not null
            and (
              a.audience = 'all'
              or (a.audience = 'role' and a.target_role = $3)
              or (a.audience = 'class' and a.target_class_id = any($4::uuid[]))
            )
          order by a.published_at desc limit $5 offset $6`,
        [auth.schoolId, auth.userId, auth.role, classIds, limit, offset],
      );
      return { items };
    });
  });

  app.post('/announcements', async (req) => {
    const auth = requirePerm(req, 'comms.manage');
    const body = parse(
      z.object({
        title: z.string().min(2).max(160),
        body: z.string().min(2).max(8000),
        audience: z.enum(['all', 'class', 'role']).default('all'),
        targetClassId: uuid.nullish(),
        targetRole: z.string().max(30).nullish(),
        publish: z.boolean().default(true),
      }),
      req.body,
    );
    if (body.audience === 'class' && !body.targetClassId) throw badRequest('برای مخاطب کلاسی، targetClassId الزامی است');
    if (body.audience === 'role' && !body.targetRole) throw badRequest('برای مخاطب نقش، targetRole الزامی است');
    return schoolTx(auth, async (db) => {
      if (body.targetClassId) {
        const cls = await db.query('select id from classes where id = $1 and school_id = $2', [
          body.targetClassId,
          auth.schoolId,
        ]);
        if (!cls[0]) throw notFound('کلاس یافت نشد');
      }
      const created = await db.one(
        `insert into announcements (school_id, academic_year_id, title, body, audience, target_class_id, target_role, created_by, published_at)
         select $1, (select id from academic_years where school_id = $1 and is_current limit 1), $2, $3, $4, $5, $6, $7,
                case when $8::boolean then now() else null end
         returning id, title, published_at`,
        [
          auth.schoolId,
          body.title,
          body.body,
          body.audience,
          body.targetClassId ?? null,
          body.targetRole ?? null,
          auth.userId,
          body.publish,
        ],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'announcement.create',
        entity: 'announcement',
        entityId: (created as { id?: string } | null)?.id ?? null,
        after: { title: body.title, audience: body.audience },
        ...clientMeta(req),
      });
      return created;
    });
  });

  app.post('/announcements/:id/read', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const exists = await db.query('select id from announcements where id = $1 and school_id = $2', [id, auth.schoolId]);
      if (!exists[0]) throw notFound('اطلاعیه یافت نشد');
      await db.query(
        `insert into announcement_reads (announcement_id, user_id) values ($1,$2)
         on conflict do nothing`,
        [id, auth.userId],
      );
      return { ok: true };
    });
  });

  app.get('/notifications', async (req) => {
    const auth = authOf(req);
    const { limit, offset } = pageParams(req, 30, 100);
    return schoolTx(auth, async (db) => {
      const items = await db.query(
        `select id, kind, title, body, link, read_at, created_at
           from notifications where user_id = $1 and school_id = $2
          order by created_at desc limit $3 offset $4`,
        [auth.userId, auth.schoolId, limit, offset],
      );
      const unread = await db.one<{ n: number }>(
        'select count(*)::int as n from notifications where user_id = $1 and school_id = $2 and read_at is null',
        [auth.userId, auth.schoolId],
      );
      return { items, unread: unread?.n ?? 0 };
    });
  });

  app.post('/notifications/read-all', async (req) => {
    const auth = authOf(req);
    return schoolTx(auth, async (db) => {
      const rows = await db.query(
        'update notifications set read_at = now() where user_id = $1 and school_id = $2 and read_at is null returning id',
        [auth.userId, auth.schoolId],
      );
      return { ok: true, updated: rows.length };
    });
  });

  app.post('/notifications/:id/read', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    return schoolTx(auth, async (db) => {
      const rows = await db.query(
        'update notifications set read_at = now() where id = $1 and user_id = $2 and school_id = $3 returning id',
        [id, auth.userId, auth.schoolId],
      );
      if (!rows[0]) throw notFound('اعلان یافت نشد');
      return { ok: true };
    });
  });

  app.get('/staff/contact', async (req) => {
    const auth = authOf(req);
    if (!auth.permissions.has('comms.manage') && !auth.permissions.has('comms.read')) throw forbidden();
    return schoolTx(auth, async (db) => ({
      items: await db.query(
        `select u.id, u.full_name, m.role, u.email, u.phone
           from memberships m join users u on u.id = m.user_id
          where m.school_id = $1 and u.is_active and m.role in ('school_admin','vice_principal','teacher','counselor','finance')
          order by u.full_name`,
        [auth.schoolId],
      ),
    }));
  });
}
