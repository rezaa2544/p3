import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { schoolTx } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { authOf, requirePerm } from '../lib/http.js';
import { parse, uuid } from '../lib/validate.js';
import { audit } from '../security/audit.js';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** جلوگیری از path traversal و نام فایل خطرناک */
function safeName(name: string): string {
  return path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 120) || 'file';
}

function mimeFromName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function registerFileRoutes(app: FastifyInstance): void {
  app.post('/files', async (req, reply) => {
    const auth = requirePerm(req, 'files.upload');
    const file = await req.file();
    if (!file) throw badRequest('فایلی ارسال نشده است');
    const fields = file.fields as Record<string, { value?: unknown } | undefined>;
    const entity = typeof fields.entity?.value === 'string' ? fields.entity.value : null;
    const entityIdRaw = typeof fields.entityId?.value === 'string' ? fields.entityId.value : null;
    if (entity && !['assignment', 'student', 'announcement'].includes(entity)) throw badRequest('نوع موجودیت نامعتبر است');
    const entityId = entityIdRaw ? parse(uuid, entityIdRaw) : null;

    const buffer = await file.toBuffer();
    const maxBytes = config().MAX_UPLOAD_BYTES;
    if (buffer.length > maxBytes) throw badRequest('حجم فایل بیش از حد مجاز است');
    if (buffer.length === 0) throw badRequest('فایل خالی است');
    const mime = file.mimetype;
    if (!ALLOWED_MIME.has(mime)) throw badRequest('نوع فایل مجاز نیست');

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const key = `${auth.schoolId}/${new Date().toISOString().slice(0, 7)}/${sha256.slice(0, 16)}-${Date.now().toString(36)}`;
    const uploadRoot = path.resolve(config().UPLOAD_DIR);
    const target = path.join(uploadRoot, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' });

    const record = await schoolTx(auth, async (db) => {
      const created = await db.one(
        `insert into files (school_id, owner_user_id, storage_key, original_name, mime, size_bytes, sha256, entity, entity_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id, original_name, mime, size_bytes, sha256, created_at`,
        [auth.schoolId, auth.userId, key, safeName(file.filename), mime, buffer.length, sha256, entity, entityId],
      );
      await audit(db, {
        schoolId: auth.schoolId,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'file.upload',
        entity: 'file',
        entityId: (created as { id?: string } | null)?.id ?? null,
        after: { name: safeName(file.filename), size: buffer.length, sha256 },
        ip: req.ip,
        requestId: String(req.id),
      });
      return created;
    });
    reply.status(201);
    return record;
  });

  app.get('/files/:id', async (req, reply) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: uuid }), req.params);
    const row = await schoolTx(auth, async (db) =>
      db.one<{
        id: string;
        owner_user_id: string;
        storage_key: string;
        original_name: string;
        mime: string;
        size_bytes: number;
        entity: string | null;
        entity_id: string | null;
        class_id: string | null;
      }>(
        `select f.id, f.owner_user_id, f.storage_key, f.original_name, f.mime, f.size_bytes, f.entity, f.entity_id,
                (select ta.class_id from assignments a join teaching_assignments ta on ta.id = a.teaching_assignment_id
                  where f.entity = 'assignment' and a.id = f.entity_id limit 1) as class_id
           from files f where f.id = $1 and f.school_id = $2`,
        [id, auth.schoolId],
      ),
    );
    if (!row) throw notFound('فایل یافت نشد');

    let allowed = row.owner_user_id === auth.userId || auth.isSuperAdmin;
    if (!allowed && auth.permissions.has('school.manage')) allowed = true;
    if (!allowed && row.class_id) {
      const check = await schoolTx(auth, async (db) =>
        db.one<{ ok: boolean }>(
          `select (
             exists(select 1 from teaching_assignments ta where ta.class_id = $1 and ta.teacher_user_id = $2)
             or exists(select 1 from enrollments e join students st on st.id = e.student_id
                        where e.class_id = $1 and st.user_id = $2)
             or exists(select 1 from student_guardians g join enrollments e on e.student_id = g.student_id
                        where e.class_id = $1 and g.guardian_user_id = $2)
           ) as ok`,
          [row.class_id, auth.userId],
        ),
      );
      allowed = check?.ok === true;
    }
    if (!allowed) throw forbidden('دسترسی به این فایل مجاز نیست');

    const filePath = path.join(path.resolve(config().UPLOAD_DIR), row.storage_key);
    if (!filePath.startsWith(path.resolve(config().UPLOAD_DIR))) throw forbidden();
    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch {
      throw notFound('محتوای فایل در دسترس نیست');
    }
    reply.header('Content-Type', row.mime);
    reply.header('Content-Length', String(data.length));
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(data);
  });
}
