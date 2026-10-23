import type { Db } from '../db.js';
import { AppError, conflict } from '../errors.js';
import { sha256 } from '../security/password.js';

export type IdempotentResult<T> = { statusCode: number; body: T; replayed: boolean };

/**
 * ثبت idempotent عملیات. کلید + کاربر + endpoint + هش بدنه در DB نگه داشته می‌شود.
 * - همان کلید و همان بدنه → همان پاسخ قبلی بازگردانده می‌شود (بدون نوشتن دوباره)
 * - همان کلید و بدنه متفاوت → 409
 * - دو درخواست هم‌زمان → دومی 409 «در حال پردازش»
 */
export async function idempotent<T>(
  db: Db,
  opts: { key: string; userId: string; endpoint: string; body: unknown },
  fn: () => Promise<{ statusCode: number; body: T }>,
): Promise<IdempotentResult<T>> {
  const requestHash = sha256(JSON.stringify(opts.body ?? null));
  const inserted = await db.query<{ key: string }>(
    `insert into idempotency_keys (key, user_id, endpoint, request_hash, status_code)
     values ($1,$2,$3,$4,0)
     on conflict (key) do nothing
     returning key`,
    [opts.key, opts.userId, opts.endpoint, requestHash],
  );

  if (inserted.length === 0) {
    const existing = await db.one<{
      user_id: string;
      endpoint: string;
      request_hash: string;
      status_code: number;
      response: unknown;
    }>('select user_id, endpoint, request_hash, status_code, response from idempotency_keys where key = $1', [
      opts.key,
    ]);
    if (!existing) throw conflict('کلید عملیات قابل بازیابی نیست؛ دوباره تلاش کنید');
    if (existing.user_id !== opts.userId || existing.endpoint !== opts.endpoint) {
      throw conflict('این کلید عملیات قبلاً برای درخواست دیگری استفاده شده است');
    }
    if (existing.request_hash !== requestHash) {
      throw conflict('همان کلید عملیات با بدنه متفاوت ارسال شده است');
    }
    if (existing.status_code === 0) {
      throw new AppError(409, 'IN_PROGRESS', 'درخواست مشابه در حال پردازش است');
    }
    return { statusCode: existing.status_code, body: existing.response as T, replayed: true };
  }

  const result = await fn();
  await db.query('update idempotency_keys set status_code = $1, response = $2 where key = $3', [
    result.statusCode,
    JSON.stringify(result.body),
    opts.key,
  ]);
  return { ...result, replayed: false };
}
