import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { globalQuery } from '../db.js';
import { AppError, badRequest, unauthorized } from '../errors.js';
import { permissionsFor, ROLE_PERMISSIONS, type Role } from './rbac.js';
import { hashToken, newToken } from './password.js';

export const SESSION_COOKIE = 'payesh2_sid';

export function cookieOptions(): CookieSerializeOptions {
  const cfg = config();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.COOKIE_SECURE,
    path: '/',
    maxAge: cfg.SESSION_TTL_HOURS * 3600,
  };
}

export async function createSession(
  userId: string,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ token: string; csrfToken: string }> {
  const token = newToken(32);
  const csrfToken = newToken(24);
  const ttlHours = config().SESSION_TTL_HOURS;
  await globalQuery(
    `insert into sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at)
     values ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval)`,
    [userId, hashToken(token), csrfToken, req.ip, (req.headers['user-agent'] ?? '').slice(0, 300), String(ttlHours)],
  );
  reply.setCookie(SESSION_COOKIE, token, cookieOptions());
  return { token, csrfToken };
}

type SessionUserRow = {
  session_id: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
  user_id: string;
  full_name: string;
  is_active: boolean;
  is_super_admin: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
};

export async function loadSession(req: FastifyRequest): Promise<SessionUserRow | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return null;
  const rows = await globalQuery<SessionUserRow>(
    `select s.id as session_id, s.csrf_token, s.expires_at, s.revoked_at,
            u.id as user_id, u.full_name, u.is_active, u.is_super_admin, u.must_change_password, u.mfa_enabled
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1`,
    [hashToken(raw)],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.revoked_at || new Date(row.expires_at) <= new Date() || !row.is_active) return null;
  return row;
}

export async function touchSession(sessionId: string): Promise<void> {
  await globalQuery(
    `update sessions set last_seen_at = now()
      where id = $1 and last_seen_at < now() - interval '5 minutes'`,
    [sessionId],
  );
}

export async function revokeSession(sessionId: string): Promise<void> {
  await globalQuery('update sessions set revoked_at = now() where id = $1 and revoked_at is null', [sessionId]);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await globalQuery(
    `update sessions set revoked_at = now()
      where user_id = $1 and revoked_at is null and ($2::uuid is null or id <> $2::uuid)`,
    [userId, exceptSessionId ?? null],
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function resolveAuth(req: FastifyRequest): Promise<void> {
  const session = await loadSession(req);
  req.auth = null;
  req.session = null;
  if (!session) return;

  const memberships = await globalQuery<{ school_id: string; role: string; school_name: string }>(
    `select m.school_id, m.role, s.name as school_name
       from memberships m join schools s on s.id = m.school_id
      where m.user_id = $1 and s.is_active`,
    [session.user_id],
  );

  const requested = (req.headers['x-school-id'] as string | undefined) ?? undefined;
  let active: { school_id: string; role: string } | undefined;

  if (session.is_super_admin) {
    if (!requested) {
      req.auth = null;
      req.session = { id: session.session_id, csrfToken: session.csrf_token };
      return;
    }
    const target = memberships.find((m) => m.school_id === requested);
    active = { school_id: requested, role: target?.role ?? ('school_admin' as Role) };
  } else if (requested) {
    const target = memberships.find((m) => m.school_id === requested);
    if (!target) return; // مدرسه‌ای که عضویت ندارد → بدون دسترسی
    active = { school_id: target.school_id, role: target.role };
  } else if (memberships.length === 1) {
    active = { school_id: memberships[0]!.school_id, role: memberships[0]!.role };
  } else if (memberships.length === 0) {
    return;
  }

  const roles = [...new Set(memberships.map((m) => m.role))];
  const effectiveRole: Role = session.is_super_admin ? 'school_admin' : ((active?.role ?? roles[0]) as Role);
  const perms = session.is_super_admin
    ? new Set(Object.values(ROLE_PERMISSIONS).flatMap((p) => [...p]))
    : permissionsFor(active ? [active.role] : roles);

  req.session = { id: session.session_id, csrfToken: session.csrf_token };
  if (!active) {
    // کاربر چند مدرسه دارد و مدرسه فعال انتخاب نشده است
    req.auth = {
      userId: session.user_id,
      fullName: session.full_name,
      isSuperAdmin: session.is_super_admin,
      roles,
      role: roles[0] ?? 'student',
      schoolId: '',
      permissions: perms,
    };
    return;
  }

  req.auth = {
    userId: session.user_id,
    fullName: session.full_name,
    isSuperAdmin: session.is_super_admin,
    roles,
    role: effectiveRole,
    schoolId: active.school_id,
    permissions: perms,
  };
  await touchSession(session.session_id);
}

export function assertCsrf(req: FastifyRequest): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.url.endsWith('/auth/login')) return;
  if (!req.auth || !req.session) throw unauthorized();
  const header = req.headers['x-csrf-token'];
  if (typeof header !== 'string' || header !== req.session.csrfToken) {
    throw new AppError(403, 'CSRF_FAILED', 'توکن امنیتی درخواست معتبر نیست');
  }
}

export function requireAuth(req: FastifyRequest): asserts req is FastifyRequest & { auth: NonNullable<FastifyRequest['auth']> } {
  if (!req.auth) throw unauthorized();
  if (!req.auth.schoolId) throw badRequest('انتخاب مدرسه فعال الزامی است (هدر X-School-Id)');
}
