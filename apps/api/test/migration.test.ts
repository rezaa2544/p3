import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv, type TestEnv } from './helpers.js';
import { migrate } from '../src/db.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

describe('Migration', () => {
  it('اجرای دوباره migration هیچ تغییری اعمال نمی‌کند', async () => {
    const applied = await migrate();
    expect(applied).toEqual([]);
    const rows = await env.dbQuery('select version from schema_migrations order by version');
    expect(rows.map((r) => r.version)).toEqual(['001_core.sql', '002_education.sql']);
  });

  it('تغییر checksum فایل migration شناسایی می‌شود', async () => {
    await env.dbQuery("update schema_migrations set checksum = 'tampered' where version = '001_core.sql'");
    await expect(migrate()).rejects.toThrow(/checksum mismatch/);
    await env.dbQuery("update schema_migrations set checksum = (select checksum from schema_migrations where version = '002_education.sql') where version = '001_core.sql'");
    // بازگرداندن مقدار واقعی با محاسبه دوباره
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { sha256 } = await import('../src/security/password.js');
    const dir = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'migrations');
    const sql = await readFile(path.join(dir, '001_core.sql'), 'utf8');
    await env.dbQuery('update schema_migrations set checksum = $1 where version = $2', [sha256(sql), '001_core.sql']);
    await expect(migrate()).resolves.toEqual([]);
  });

  it('محدودیت‌های کلیدی پایگاه داده فعال هستند', async () => {
    await expect(
      env.dbQuery(
        `insert into attendance_records (school_id, academic_year_id, class_id, student_id, day, period_no, status, recorded_by)
         values ($1,$2,$3,$4,'2025-10-01',1,'invalid-status',$5)`,
        [env.fx.schoolA, env.fx.yearA, env.fx.classA1, env.fx.student1, env.fx.users.adminA],
      ),
    ).rejects.toThrow();
    await expect(
      env.dbQuery(
        `insert into academic_years (school_id, title, starts_on, ends_on, is_current) values ($1,'سال دوم','2026-09-01','2027-06-01',true)`,
        [env.fx.schoolA],
      ),
    ).rejects.toThrow(/academic_years_one_current|duplicate/);
  });

  it('شاخص‌های یکتا از ثبت تکراری جلوگیری می‌کنند', async () => {
    await expect(
      env.dbQuery('insert into student_guardians (student_id, guardian_user_id, relation) values ($1,$2,$3)', [
        env.fx.student1,
        env.fx.users.guardianS1,
        'mother',
      ]),
    ).rejects.toThrow(/duplicate|unique/i);
  });
});
