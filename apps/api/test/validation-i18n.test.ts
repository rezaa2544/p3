import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parse, uuid } from '../src/lib/validate.js';
import { AppError } from '../src/errors.js';
import '../src/lib/zod-fa.js';

const issueMessages = (schema: z.ZodTypeAny, value: unknown): string[] => {
  const res = schema.safeParse(value);
  expect(res.success).toBe(false);
  return res.error!.issues.map((i) => i.message);
};

describe('پیام‌های اعتبارسنجی فارسی (zod 4 + بستهٔ زبان fa)', () => {
  it('خطای نوع داده فارسی است، نه انگلیسی', () => {
    const [msg] = issueMessages(z.object({ name: z.string() }), { name: 123 });
    expect(msg).toContain('ورودی نامعتبر');
    expect(msg).toContain('متن');
    expect(msg).toContain('عدد');
    expect(msg).not.toMatch(/expected|received|Invalid input/i);
  });

  it('خطای گزینهٔ نامعتبر و ایمیل هم فارسی است', () => {
    const enumMsg = issueMessages(z.enum(['present', 'absent']), 'unknown')[0]!;
    expect(enumMsg).toContain('گزینه نامعتبر');
    const emailMsg = issueMessages(z.string().email(), 'not-an-email')[0]!;
    expect(emailMsg).toBe('آدرس ایمیل نامعتبر');
  });

  it('پیام سفارشی خودمان دست‌نخورده می‌ماند', () => {
    const [msg] = issueMessages(z.string().uuid('شناسه نامعتبر است'), 'not-a-uuid');
    expect(msg).toBe('شناسه نامعتبر است');
  });

  it('نوع دریافتی هم فارسی گزارش می‌شود (null و فهرست)', () => {
    const nullMsg = issueMessages(z.object({ n: z.number() }), { n: null })[0]!;
    expect(nullMsg).toContain('خالی');
    expect(nullMsg).not.toContain('null');
    const listMsg = issueMessages(z.object({ tags: z.array(z.string()) }), { tags: {} })[0]!;
    // بستهٔ زبان fa خودش «آرایه» می‌گوید؛ مهم این است که انگلیسی نماند
    expect(listMsg).toMatch(/آرایه|فهرست/);
    expect(listMsg).not.toMatch(/array|Array/);
  });

  it('parse() پیام فارسی را در details پاسخ ۴۰۰ برمی‌گرداند', () => {
    const schema = z.object({ classId: uuid, periodNo: z.number().int().min(0).max(12) });
    try {
      parse(schema, { classId: 'x', periodNo: 99 });
      throw new Error('باید خطا می‌داد');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.statusCode).toBe(400);
      const details = err.details as { path: string; message: string }[];
      expect(details.map((d) => d.path).sort()).toEqual(['classId', 'periodNo']);
      expect(details.find((d) => d.path === 'classId')?.message).toBe('شناسه نامعتبر است');
      for (const d of details) expect(d.message).not.toMatch(/expected|Invalid/i);
    }
  });

  it('zod نسخهٔ ۴ نصب است (رفع آسیب‌پذیری CVE-2023-54404)', () => {
    const major = Number(z.core.version.major);
    expect(major).toBeGreaterThanOrEqual(4);
    const [minor, patch] = [Number(z.core.version.minor), Number(z.core.version.patch)];
    expect(minor * 1000 + patch).toBeGreaterThanOrEqual(6006);
  });
});
