import { describe, expect, it } from 'vitest';
import { computeSubjectAverage, describeAverage, type AssessmentScore } from '../src/services/grading.js';
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from '../src/security/totp.js';
import { hashPassword, verifyPassword } from '../src/security/password.js';

const item = (score: number | null, extra: Partial<AssessmentScore> = {}): AssessmentScore => ({
  id: Math.random().toString(36),
  title: 't',
  maxScore: 20,
  weight: 1,
  score,
  status: 'approved',
  approved: true,
  ...extra,
});

describe('محاسبه میانگین نمرات', () => {
  it('میانگین وزنی با نرمال‌سازی به مقیاس ۲۰', () => {
    const r = computeSubjectAverage([item(20), item(10), item(10, { maxScore: 10 })]);
    // (20/20*20 + 10/20*20 + 10/10*20)/3 = (20+10+20)/3 = 16.67
    expect(r.average).toBe(16.67);
    expect(r.counted).toBe(3);
    expect(r.complete).toBe(true);
  });

  it('وزن‌ها اعمال می‌شوند', () => {
    const r = computeSubjectAverage([item(20, { weight: 3 }), item(10, { weight: 1 })]);
    expect(r.average).toBe(17.5);
  });

  it('نمره تأییدنشده محاسبه نمی‌شود و ناقص بودن گزارش می‌شود', () => {
    const r = computeSubjectAverage([item(18), item(null), item(5, { approved: false })]);
    expect(r.average).toBe(18);
    expect(r.counted).toBe(1);
    expect(r.missing).toBe(1);
    expect(r.excluded).toBe(1);
    expect(r.complete).toBe(false);
    expect(describeAverage(r)).toBe('incomplete');
  });

  it('بدون داده، میانگین null است و صفر ساخته نمی‌شود', () => {
    const r = computeSubjectAverage([item(null), item(5, { approved: false })]);
    expect(r.average).toBeNull();
    expect(describeAverage(r)).toBe('no-data');
  });

  it('قبولی و ردشدن بر اساس آستانه', () => {
    expect(describeAverage(computeSubjectAverage([item(9)]), 10)).toBe('fail');
    expect(describeAverage(computeSubjectAverage([item(10)]), 10)).toBe('pass');
    const r = computeSubjectAverage([item(12), item(15)]);
    expect(r.average).toBe(13.5);
  });
});

describe('TOTP', () => {
  it('base32 رفت و برگشت درست است', () => {
    const buf = Buffer.from('payesh2-secret');
    expect(base32Decode(base32Encode(buf)).toString()).toBe('payesh2-secret');
  });

  it('کد در پنجره زمانی جاری معتبر و کد نامعتبر رد می‌شود', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const code = totpCode(secret, Math.floor(now / 1000 / 30));
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, '000001', now)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false);
    // کد دوره قبل هم پذیرفته می‌شود (±۱)
    const prev = totpCode(secret, Math.floor(now / 1000 / 30) - 1);
    expect(verifyTotp(secret, prev, now)).toBe(true);
    // کد دو دوره قبل پذیرفته نمی‌شود
    const old = totpCode(secret, Math.floor(now / 1000 / 30) - 3);
    expect(verifyTotp(secret, old, now)).toBe(false);
  });
});

describe('هش رمز', () => {
  it('هش scrypt با salt تصادفی و verify درست', async () => {
    const a = await hashPassword('Secret12345');
    const b = await hashPassword('Secret12345');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('Secret12345', a)).toBe(true);
    expect(await verifyPassword('Secret12346', a)).toBe(false);
    expect(await verifyPassword('Secret12345', 'garbage')).toBe(false);
  });
});
