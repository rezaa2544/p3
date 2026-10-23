import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupEnv, PASSWORD, type TestEnv } from './helpers.js';
import { createBackup, restoreBackup, restoreIntoEmptyDatabase } from '../src/services/backup.js';
import { getPool } from '../src/db.js';

let env: TestEnv;
let backupDir: string;

beforeAll(async () => {
  env = await setupEnv();
  backupDir = await mkdtemp(path.join(os.tmpdir(), 'payesh-backup-'));
});
afterAll(async () => {
  await env.close();
  await rm(backupDir, { recursive: true, force: true });
});

describe('پشتیبان‌گیری و بازیابی', () => {
  it('پشتیبان متنی با manifest و checksum ساخته می‌شود', async () => {
    const manifest = await createBackup(backupDir);
    expect(manifest.tables.length).toBeGreaterThan(10);
    expect(manifest.migrations).toContain('001_core.sql');
    const students = manifest.tables.find((t) => t.name === 'students');
    expect(students?.rows).toBe(3);
    const file = await readFile(path.join(backupDir, students!.file), 'utf8');
    expect(file.trim().split('\n')).toHaveLength(3);
    const studentsRaw = await env.dbQuery('select count(*)::int as n from students');
    expect(studentsRaw[0].n).toBe(3);
  });

  it('پس از حذف داده، بازیابی همه ردیف‌ها را برمی‌گرداند', async () => {
    const before = await env.dbQuery('select count(*)::int as n from grades');
    const pool = getPool();
    await pool.query('delete from grade_revisions');
    await pool.query('delete from grades');
    await pool.query('delete from attendance_revisions');
    await pool.query('delete from attendance_records');
    await pool.query('delete from student_guardians');
    await pool.query('delete from enrollments');
    await pool.query('delete from students');
    const empty = await env.dbQuery('select count(*)::int as n from students');
    expect(empty[0].n).toBe(0);

    const result = await restoreBackup(backupDir);
    expect(result.rows).toBeGreaterThan(0);

    const students = await env.dbQuery('select count(*)::int as n from students');
    expect(students[0].n).toBe(3);
    const grades = await env.dbQuery('select count(*)::int as n from grades');
    expect(grades[0].n).toBe(before[0].n);
    const links = await env.dbQuery('select count(*)::int as n from student_guardians');
    expect(links[0].n).toBe(2);
  });

  it('پس از بازیابی، ورود و عملیات کاربران کار می‌کند', async () => {
    const auth = await env.login('adminA', PASSWORD);
    const res = await env.request('GET', '/api/students', { auth });
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(2);
    const create = await env.request('POST', '/api/students', {
      auth,
      body: { firstName: 'پس', lastName: 'بازیابی' },
    });
    expect(create.status).toBe(200);
  });

  it('فایل پشتیبان دست‌کاری‌شده رد می‌شود', async () => {
    const tampered = await mkdtemp(path.join(os.tmpdir(), 'payesh-tamper-'));
    try {
      const manifest = await createBackup(tampered);
      const target = manifest.tables.find((t) => t.name === 'students')!;
      const filePath = path.join(tampered, target.file);
      const content = await readFile(filePath, 'utf8');
      const fs = await import('node:fs/promises');
      await fs.writeFile(filePath, content.replace('سارا', 'دستکاری'), 'utf8');
      await expect(restoreBackup(tampered)).rejects.toThrow(/checksum/);
    } finally {
      await rm(tampered, { recursive: true, force: true });
    }
  });
});

describe('آماده‌سازی محیط تازه از پشتیبان', () => {
  it('restoreIntoEmptyDatabase روی پایگاه داده تازه اجرا می‌شود', async () => {
    // همان پایگاه داده فعلی، اما مسیر تولیدی (migrate + restore) آزموده می‌شود
    const result = await restoreIntoEmptyDatabase(backupDir);
    expect(result.migrations).toBe(0); // migrationها از قبل اعمال شده‌اند
    expect(result.rows).toBeGreaterThan(0);
    const tables = await env.dbQuery("select table_name from information_schema.tables where table_schema='public'");
    expect(tables.length).toBeGreaterThan(10);
  });
});
