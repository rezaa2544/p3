import { z } from 'zod';
import { badRequest, AppError } from '../errors.js';

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest('داده ورودی نامعتبر است', details);
  }
  return result.data;
}

export const uuid = z.string().uuid('شناسه نامعتبر است');
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به شکل YYYY-MM-DD باشد')
  .refine((v) => !Number.isNaN(Date.parse(v + 'T00:00:00Z')), 'تاریخ نامعتبر است');
export const idempotencyKey = z
  .string()
  .min(8, 'شناسه عملیات باید حداقل ۸ کاراکتر باشد')
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/, 'شناسه عملیات شامل کاراکتر غیرمجاز است');

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'هدر Idempotency-Key الزامی است');
  return parse(idempotencyKey, value);
}
