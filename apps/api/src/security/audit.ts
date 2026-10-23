import type { Db } from '../db.js';

export type AuditEntry = {
  schoolId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

/** ثبت در audit_log داخل همان تراکنش عملیات، تا موفقیت عملیات و ثبت لاگ اتمیک باشد. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `insert into audit_log (school_id, actor_user_id, actor_role, action, entity, entity_id, before_data, after_data, ip, user_agent, request_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      entry.schoolId ?? null,
      entry.actorUserId ?? null,
      entry.actorRole ?? null,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
      entry.userAgent ?? null,
      entry.requestId ?? null,
    ],
  );
}

/** حذف کلیدهای حساس پیش از ورود به audit یا log */
export function redact(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/password|token|secret|authorization|cookie|csrf/i.test(k)) out[k] = '[redacted]';
    else out[k] = redact(v);
  }
  return out;
}
