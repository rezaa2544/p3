import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { closePool, migrate } from '../src/db.js';
import { resetConfigCache } from '../src/config.js';
import { hashPassword } from '../src/security/password.js';

export type Fixtures = {
  schoolA: string;
  schoolB: string;
  yearA: string;
  termA: string;
  classA1: string;
  classA2: string;
  classB1: string;
  subjectMath: string;
  subjectSci: string;
  student1: string;
  student2: string;
  student3: string;
  users: {
    adminA: string;
    adminB: string;
    viceA: string;
    teacherAssigned: string;
    teacherUnassigned: string;
    guardianS1: string;
    guardianS2: string;
    student1User: string;
    itA: string;
  };
};

export const PASSWORD = 'Test1234pass';

let portCursor = 21000 + (process.pid % 2000);

async function startPglite(port: number, dataDir?: string) {
  const db = await PGlite.create(dataDir ? { dataDir } : undefined);
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  return { db, server, port };
}

async function tryStart(): Promise<{ url: string; db: PGlite; server: PGLiteSocketServer; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'payesh-test-'));
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = portCursor++;
    try {
      const { db, server } = await startPglite(port, dir);
      return { url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`, db, server, dir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('could not allocate test port');
}

export type TestEnv = {
  app: FastifyInstance;
  fx: Fixtures;
  login: (username: string, password?: string, schoolId?: string) => Promise<{ cookie: string; csrf: string }>;
  request: (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    opts?: { body?: unknown; headers?: Record<string, string>; auth?: { cookie: string; csrf: string } },
  ) => Promise<{ status: number; json: any; headers: Record<string, unknown>; body: string }>;
  close: () => Promise<void>;
  dbQuery: (sql: string, params?: unknown[]) => Promise<any[]>;
  restart: () => Promise<void>;
  dataDir: string;
};

export async function setupEnv(): Promise<TestEnv> {
  const started = await tryStart();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = started.url;
  process.env.SESSION_SECRET = 'test-secret-key-0123456789-abcdefghijklmnop';
  process.env.COOKIE_SECURE = '0';
  process.env.SEED_DEMO = '0';
  process.env.APP_ORIGIN = 'http://localhost:5173';
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.LOGIN_RATE_LIMIT_MAX = '100000';
  process.env.DB_POOL_MAX = '1';
  process.env.PAYESH_EMBEDDED_DB = '1';
  process.env.LOG_LEVEL = 'silent';
  process.env.UPLOAD_DIR = path.join(started.dir, 'uploads');
  resetConfigCache();

  await migrate();
  const app = await buildApp({ logger: false });
  await app.ready();
  const fx = await seedFixtures();

  const request: TestEnv['request'] = async (method, url, opts = {}) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.auth) {
      headers.cookie = opts.auth.cookie;
      if (method !== 'GET') headers['x-csrf-token'] = opts.auth.csrf;
    }
    const res = await app.inject({ method, url, headers, payload: opts.body as object | undefined });
    let json: unknown = null;
    try {
      json = res.body ? JSON.parse(res.body) : null;
    } catch {
      json = null;
    }
    return { status: res.statusCode, json, headers: res.headers as Record<string, unknown>, body: res.body };
  };

  const login: TestEnv['login'] = async (username, password = PASSWORD, schoolId) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: schoolId ? { 'x-school-id': schoolId } : {},
      payload: { username, password },
    });
    if (res.statusCode !== 200) {
      throw new Error(`login failed for ${username}: ${res.statusCode} ${res.body}`);
    }
    const body = JSON.parse(res.body) as { csrfToken: string };
    const setCookie = res.headers['set-cookie'];
    const rawCookie = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
    const cookie = rawCookie.split(';')[0]!;
    return { cookie, csrf: body.csrfToken };
  };

  const close = async () => {
    await app.close();
    await closePool();
    await started.server.stop();
    await started.db.close();
    await rm(started.dir, { recursive: true, force: true });
  };

  const dbQuery = async (sql: string, params: unknown[] = []) => {
    const { globalQuery } = await import('../src/db.js');
    return globalQuery(sql, params);
  };

  return {
    app,
    fx,
    login,
    request,
    close,
    dbQuery,
    dataDir: started.dir,
    restart: async () => {
      await closePool();
      resetConfigCache();
    },
  };
}

export async function seedFixtures(): Promise<Fixtures> {
  const { getPool } = await import('../src/db.js');
  const pool = getPool();
  const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];
  const one = async <T = any>(sql: string, params: unknown[] = []): Promise<T> => (await q<T>(sql, params))[0]!;

  const hash = await hashPassword(PASSWORD);
  const mkUser = async (username: string, fullName: string, superAdmin = false) =>
    (
      await one<{ id: string }>(
        'insert into users (username, password_hash, full_name, is_super_admin) values ($1,$2,$3,$4) returning id',
        [username, hash, fullName, superAdmin],
      )
    ).id;
  const mkMember = async (userId: string, schoolId: string, role: string) =>
    q('insert into memberships (user_id, school_id, role) values ($1,$2,$3)', [userId, schoolId, role]);

  const orgA = await one<{ id: string }>("insert into organizations (name) values ('سازمان الف') returning id");
  const orgB = await one<{ id: string }>("insert into organizations (name) values ('سازمان ب') returning id");
  const schoolA = await one<{ id: string }>(
    "insert into schools (org_id, name, code, city) values ($1,'مدرسه الف','TA','تهران') returning id",
    [orgA.id],
  );
  const schoolB = await one<{ id: string }>(
    "insert into schools (org_id, name, code, city) values ($1,'مدرسه ب','TB','شیراز') returning id",
    [orgB.id],
  );
  const yearA = await one<{ id: string }>(
    "insert into academic_years (school_id, title, starts_on, ends_on, is_current) values ($1,'۱۴۰۴-۱۴۰۵','2025-09-23','2026-06-20',true) returning id",
    [schoolA.id],
  );
  const termA = await one<{ id: string }>(
    "insert into terms (academic_year_id, title, seq, starts_on, ends_on) values ($1,'نیم‌سال اول',1,'2025-09-23','2026-01-20') returning id",
    [yearA.id],
  );
  const gradeA = await one<{ id: string }>(
    "insert into grade_levels (school_id, title, seq) values ($1,'هفتم',1) returning id",
    [schoolA.id],
  );
  const classA1 = await one<{ id: string }>(
    'insert into classes (school_id, academic_year_id, grade_level_id, title) values ($1,$2,$3,$4) returning id',
    [schoolA.id, yearA.id, gradeA.id, 'هفتم ۱'],
  );
  const classA2 = await one<{ id: string }>(
    'insert into classes (school_id, academic_year_id, grade_level_id, title) values ($1,$2,$3,$4) returning id',
    [schoolA.id, yearA.id, gradeA.id, 'هفتم ۲'],
  );
  const yearB = await one<{ id: string }>(
    "insert into academic_years (school_id, title, starts_on, ends_on, is_current) values ($1,'۱۴۰۴-۱۴۰۵','2025-09-23','2026-06-20',true) returning id",
    [schoolB.id],
  );
  const classB1 = await one<{ id: string }>(
    'insert into classes (school_id, academic_year_id, title) values ($1,$2,$3) returning id',
    [schoolB.id, yearB.id, 'هفتم ۱'],
  );
  const subjectMath = await one<{ id: string }>(
    "insert into subjects (school_id, title, code) values ($1,'ریاضی','MATH') returning id",
    [schoolA.id],
  );
  const subjectSci = await one<{ id: string }>(
    "insert into subjects (school_id, title, code) values ($1,'علوم','SCI') returning id",
    [schoolA.id],
  );

  const adminA = await mkUser('adminA', 'مدیر الف');
  await mkMember(adminA, schoolA.id, 'school_admin');
  const adminB = await mkUser('adminB', 'مدیر ب');
  await mkMember(adminB, schoolB.id, 'school_admin');
  const viceA = await mkUser('viceA', 'معاون الف');
  await mkMember(viceA, schoolA.id, 'vice_principal');
  const teacherAssigned = await mkUser('teacher1', 'دبیر ریاضی');
  await mkMember(teacherAssigned, schoolA.id, 'teacher');
  const teacherUnassigned = await mkUser('teacher2', 'دبیر بدون تخصیص');
  await mkMember(teacherUnassigned, schoolA.id, 'teacher');
  const guardianS1 = await mkUser('guardian1', 'ولی دانش‌آموز ۱');
  await mkMember(guardianS1, schoolA.id, 'guardian');
  const guardianS2 = await mkUser('guardian2', 'ولی دانش‌آموز ۲');
  await mkMember(guardianS2, schoolA.id, 'guardian');
  const student1User = await mkUser('student1', 'دانش‌آموز ۱');
  await mkMember(student1User, schoolA.id, 'student');
  const itA = await mkUser('itA', 'اپراتور الف');
  await mkMember(itA, schoolA.id, 'it_operator');

  await q(
    'insert into teaching_assignments (school_id, academic_year_id, class_id, subject_id, teacher_user_id) values ($1,$2,$3,$4,$5)',
    [schoolA.id, yearA.id, classA1.id, subjectMath.id, teacherAssigned],
  );
  await q(
    'insert into teaching_assignments (school_id, academic_year_id, class_id, subject_id, teacher_user_id) values ($1,$2,$3,$4,$5)',
    [schoolA.id, yearA.id, classA2.id, subjectMath.id, teacherUnassigned],
  );

  const mkStudent = async (schoolId: string, first: string, last: string, userId?: string) =>
    (
      await one<{ id: string }>(
        'insert into students (school_id, user_id, first_name, last_name) values ($1,$2,$3,$4) returning id',
        [schoolId, userId ?? null, first, last],
      )
    ).id;
  const student1 = await mkStudent(schoolA.id, 'سارا', 'نمونه', student1User);
  const student2 = await mkStudent(schoolA.id, 'نیما', 'نمونه');
  const student3 = await mkStudent(schoolB.id, 'آرمین', 'نمونه');

  await q('insert into enrollments (student_id, academic_year_id, class_id) values ($1,$2,$3)', [student1, yearA.id, classA1.id]);
  await q('insert into enrollments (student_id, academic_year_id, class_id) values ($1,$2,$3)', [student2, yearA.id, classA2.id]);
  await q('insert into enrollments (student_id, academic_year_id, class_id) values ($1,$2,$3)', [student3, yearB.id, classB1.id]);

  await q(
    'insert into student_guardians (student_id, guardian_user_id, relation, is_primary) values ($1,$2,$3,true)',
    [student1, guardianS1, 'mother'],
  );
  await q(
    'insert into student_guardians (student_id, guardian_user_id, relation, is_primary) values ($1,$2,$3,true)',
    [student2, guardianS2, 'father'],
  );

  return {
    schoolA: schoolA.id,
    schoolB: schoolB.id,
    yearA: yearA.id,
    termA: termA.id,
    classA1: classA1.id,
    classA2: classA2.id,
    classB1: classB1.id,
    subjectMath: subjectMath.id,
    subjectSci: subjectSci.id,
    student1,
    student2,
    student3,
    users: { adminA, adminB, viceA, teacherAssigned, teacherUnassigned, guardianS1, guardianS2, student1User, itA },
  };
}
