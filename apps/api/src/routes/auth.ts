import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { globalQuery, schoolTx } from '../db.js';
import { AppError, badRequest, unauthorized } from '../errors.js';
import { authOf, clientMeta } from '../lib/http.js';
import { parse } from '../lib/validate.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from '../security/totp.js';
import {
  clearSessionCookie,
  createSession,
  loadSession,
  revokeAllSessions,
  revokeSession,
} from '../security/session.js';
import { audit } from '../security/audit.js';

type UserRow = {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  full_name: string;
  is_active: boolean;
  is_super_admin: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  mfa_secret: string | null;
};

const loginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
  mfaCode: z.string().max(10).optional(),
});

const passwordSchema = z
  .string()
  .min(10, 'رمز عبور باید حداقل ۱۰ کاراکتر باشد')
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'رمز عبور باید شامل حرف و رقم باشد');

const LOCK_WINDOW_MIN = 15;
const MAX_FAILED = 8;
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function membershipsOf(userId: string) {
  return globalQuery<{ school_id: string; school_name: string; role: string }>(
    `select m.school_id, s.name as school_name, m.role
       from memberships m join schools s on s.id = m.school_id
      where m.user_id = $1 and s.is_active
      order by s.name`,
    [userId],
  );
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: config().LOGIN_RATE_LIMIT_MAX, timeWindow: '15 minutes' } },
      schema: { body: { type: 'object' } },
    },
    async (req, reply) => {
      const body = parse(loginSchema, req.body);
      const identifier = body.username.trim().toLowerCase();
      const meta = clientMeta(req);

      const recent = await globalQuery<{ n: number }>(
        `select count(*)::int as n from login_attempts
          where lower(identifier) = $1 and success = false and created_at > now() - ($2 || ' minutes')::interval`,
        [identifier, String(LOCK_WINDOW_MIN)],
      );
      if ((recent[0]?.n ?? 0) >= MAX_FAILED) {
        throw new AppError(429, 'ACCOUNT_LOCKED', 'تلاش‌های ناموفق زیاد است؛ چند دقیقه بعد دوباره تلاش کنید');
      }

      const rows = await globalQuery<UserRow>(
        `select id, username, email, password_hash, full_name, is_active, is_super_admin,
                must_change_password, mfa_enabled, mfa_secret
           from users
          where lower(username) = $1 or lower(email) = $1
          limit 2`,
        [identifier],
      );
      const user = rows.length === 1 ? rows[0]! : undefined;
      const okPassword = await verifyPassword(body.password, user?.password_hash ?? DUMMY_HASH);
      const success = Boolean(user && okPassword && user.is_active);

      await globalQuery('insert into login_attempts (identifier, ip, success) values ($1,$2,$3)', [
        identifier,
        meta.ip,
        success,
      ]);

      if (!user || !success) {
        throw unauthorized('نام کاربری یا رمز عبور نادرست است، یا حساب غیرفعال است');
      }

      if (user.mfa_enabled) {
        if (!body.mfaCode) {
          throw new AppError(401, 'MFA_REQUIRED', 'کد تأیید دو‌مرحله‌ای لازم است', { mfaRequired: true });
        }
        if (!user.mfa_secret || !verifyTotp(user.mfa_secret, body.mfaCode)) {
          throw unauthorized('کد تأیید دو‌مرحله‌ای نامعتبر است');
        }
      }

      await globalQuery('update users set last_login_at = now(), failed_attempts = 0, locked_until = null where id = $1', [
        user.id,
      ]);
      const { csrfToken } = await createSession(user.id, req, reply);
      const memberships = await membershipsOf(user.id);

      if (memberships[0]) {
        const schoolId = memberships[0].school_id;
        await schoolTx({ schoolId, role: memberships[0].role, userId: user.id }, (db) =>
          audit(db, {
            schoolId,
            actorUserId: user.id,
            actorRole: memberships[0]!.role,
            action: 'auth.login',
            entity: 'user',
            entityId: user.id,
            ...meta,
          }),
        );
      }

      return {
        user: {
          id: user.id,
          fullName: user.full_name,
          username: user.username,
          isSuperAdmin: user.is_super_admin,
          mustChangePassword: user.must_change_password,
        },
        memberships: memberships.map((m) => ({ schoolId: m.school_id, schoolName: m.school_name, role: m.role })),
        csrfToken,
      };
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    if (req.session) await revokeSession(req.session.id);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const auth = authOf(req);
    const memberships = await membershipsOf(auth.userId);
    const session = await loadSession(req);
    return {
      user: {
        id: auth.userId,
        fullName: auth.fullName,
        isSuperAdmin: auth.isSuperAdmin,
        mustChangePassword: Boolean(session?.must_change_password),
        mfaEnabled: Boolean(session?.mfa_enabled),
      },
      activeSchoolId: auth.schoolId,
      role: auth.role,
      roles: auth.roles,
      permissions: [...auth.permissions],
      memberships: memberships.map((m) => ({ schoolId: m.school_id, schoolName: m.school_name, role: m.role })),
      csrfToken: req.session?.csrfToken ?? null,
    };
  });

  app.post('/auth/change-password', async (req) => {
    const auth = authOf(req);
    const body = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      req.body,
    );
    const user = await globalQuery<UserRow>('select * from users where id = $1', [auth.userId]);
    const row = user[0];
    if (!row) throw unauthorized();
    if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
      throw badRequest('رمز عبور فعلی نادرست است');
    }
    if (await verifyPassword(body.newPassword, row.password_hash)) {
      throw badRequest('رمز عبور جدید نباید با رمز فعلی یکسان باشد');
    }
    await globalQuery(
      'update users set password_hash = $1, must_change_password = false, updated_at = now() where id = $2',
      [await hashPassword(body.newPassword), auth.userId],
    );
    await revokeAllSessions(auth.userId, req.session?.id);
    return { ok: true };
  });

  app.get('/auth/sessions', async (req) => {
    const auth = authOf(req);
    const rows = await globalQuery(
      `select id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
         from sessions where user_id = $1 order by created_at desc limit 50`,
      [auth.userId],
    );
    return { items: rows };
  });

  app.delete('/auth/sessions/:id', async (req) => {
    const auth = authOf(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const rows = await globalQuery<{ user_id: string }>('select user_id from sessions where id = $1', [id]);
    if (!rows[0] || (rows[0].user_id !== auth.userId && !auth.isSuperAdmin)) {
      throw new AppError(404, 'NOT_FOUND', 'نشست یافت نشد');
    }
    await revokeSession(id);
    return { ok: true };
  });

  app.post('/auth/mfa/enroll', async (req) => {
    const auth = authOf(req);
    const secret = generateTotpSecret();
    await globalQuery('update users set mfa_secret = $1, mfa_enabled = false where id = $2', [secret, auth.userId]);
    const me = await globalQuery<{ username: string }>('select username from users where id = $1', [auth.userId]);
    return { secret, uri: otpauthUri(secret, me[0]?.username ?? auth.userId) };
  });

  app.post('/auth/mfa/confirm', async (req) => {
    const auth = authOf(req);
    const body = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    const rows = await globalQuery<{ mfa_secret: string | null }>('select mfa_secret from users where id = $1', [
      auth.userId,
    ]);
    const secret = rows[0]?.mfa_secret;
    if (!secret) throw badRequest('ابتدا فرایند فعال‌سازی MFA را آغاز کنید');
    if (!verifyTotp(secret, body.code)) throw badRequest('کد تأیید نامعتبر است');
    await globalQuery('update users set mfa_enabled = true where id = $1', [auth.userId]);
    return { ok: true, mfaEnabled: true };
  });

  app.post('/auth/mfa/disable', async (req) => {
    const auth = authOf(req);
    const body = parse(z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/) }), req.body);
    const rows = await globalQuery<UserRow>('select * from users where id = $1', [auth.userId]);
    const row = rows[0];
    if (!row || !(await verifyPassword(body.password, row.password_hash))) throw unauthorized('رمز عبور نادرست است');
    if (!row.mfa_secret || !verifyTotp(row.mfa_secret, body.code)) throw badRequest('کد تأیید نامعتبر است');
    await globalQuery('update users set mfa_enabled = false, mfa_secret = null where id = $1', [auth.userId]);
    return { ok: true, mfaEnabled: false };
  });

  app.get('/auth/config', async () => ({
    productName: 'پایش ۲',
    version: process.env.APP_VERSION ?? '0.1.0',
    environment: config().NODE_ENV,
  }));
}
