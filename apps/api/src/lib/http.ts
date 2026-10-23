import type { FastifyRequest } from 'fastify';
import { badRequest, forbidden, unauthorized } from '../errors.js';
import type { AuthContext } from './scope.js';

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  if (!req.auth.schoolId) throw badRequest('انتخاب مدرسه فعال الزامی است (هدر X-School-Id)');
  return req.auth;
}

export function can(auth: AuthContext, permission: string): boolean {
  return auth.isSuperAdmin || auth.permissions.has(permission);
}

export function requirePerm(req: FastifyRequest, permission: string): AuthContext {
  const auth = authOf(req);
  if (!can(auth, permission)) throw forbidden('برای این عملیات مجوز ندارید');
  return auth;
}

export type Page = { limit: number; offset: number; page: number };

export function pageParams(req: FastifyRequest, def = 25, max = 200): Page {
  const qs = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number.parseInt(qs.page ?? '1', 10) || 1);
  const limit = Math.min(max, Math.max(1, Number.parseInt(qs.limit ?? String(def), 10) || def));
  return { page, limit, offset: (page - 1) * limit };
}

export function dateOrThrow(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z'))) {
    throw badRequest(`${field} باید تاریخ معتبر YYYY-MM-DD باشد`);
  }
  return value;
}

/** تاریخ امروز به وقت تهران (منبع معتبر زمان، سرور است نه دستگاه کاربر) */
export function todayTehran(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function clientMeta(req: FastifyRequest) {
  return {
    ip: req.ip,
    userAgent: (req.headers['user-agent'] ?? '').toString().slice(0, 300),
    requestId: String(req.id),
  };
}
