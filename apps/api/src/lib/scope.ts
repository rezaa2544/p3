import type { Db } from '../db.js';
import { forbidden, notFound } from '../errors.js';

export type AuthContext = {
  userId: string;
  fullName: string;
  isSuperAdmin: boolean;
  roles: string[];
  role: string;
  schoolId: string;
  permissions: Set<string>;
};

export async function getCurrentAcademicYear(db: Db, schoolId: string): Promise<{ id: string } | null> {
  return db.one<{ id: string }>(
    'select id from academic_years where school_id = $1 and is_current order by starts_on desc limit 1',
    [schoolId],
  );
}

export async function requireCurrentYear(db: Db, schoolId: string): Promise<string> {
  const y = await getCurrentAcademicYear(db, schoolId);
  if (!y) throw notFound('سال تحصیلی جاری تعریف نشده است');
  return y.id;
}

export async function assertClassInSchool(db: Db, classId: string, schoolId: string): Promise<{ id: string; academic_year_id: string }> {
  const cls = await db.one<{ id: string; academic_year_id: string }>(
    'select id, academic_year_id from classes where id = $1 and school_id = $2',
    [classId, schoolId],
  );
  if (!cls) throw notFound('کلاس در این مدرسه یافت نشد');
  return cls;
}

export async function assertStudentInSchool(db: Db, studentId: string, schoolId: string): Promise<{ id: string; user_id: string | null }> {
  const st = await db.one<{ id: string; user_id: string | null }>(
    'select id, user_id from students where id = $1 and school_id = $2',
    [studentId, schoolId],
  );
  if (!st) throw notFound('دانش‌آموز در این مدرسه یافت نشد');
  return st;
}

/** آیا دبیر به این کلاس (و اختیاری: درس) تخصیص دارد؟ */
export async function teacherAssignedTo(
  db: Db,
  teacherUserId: string,
  classId: string,
  subjectId?: string,
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `select ta.id from teaching_assignments ta
      join academic_years y on y.id = ta.academic_year_id and y.is_current
      where ta.teacher_user_id = $1 and ta.class_id = $2
        and ($3::uuid is null or ta.subject_id = $3::uuid)`,
    [teacherUserId, classId, subjectId ?? null],
  );
  return rows.length > 0;
}

export async function assertTeacherAssigned(
  db: Db,
  teacherUserId: string,
  classId: string,
  subjectId?: string,
): Promise<void> {
  if (!(await teacherAssignedTo(db, teacherUserId, classId, subjectId))) {
    throw forbidden('شما به این کلاس/درس تخصیص ندارید');
  }
}

/** رابطه ولی با دانش‌آموز، از جمله اجازه مشاهده نمره یا حضور */
export async function guardianLink(
  db: Db,
  guardianUserId: string,
  studentId: string,
): Promise<{ can_view_grades: boolean; can_view_attendance: boolean } | null> {
  return db.one<{ can_view_grades: boolean; can_view_attendance: boolean }>(
    'select can_view_grades, can_view_attendance from student_guardians where guardian_user_id = $1 and student_id = $2',
    [guardianUserId, studentId],
  );
}

export async function studentByUserId(db: Db, userId: string): Promise<{ id: string } | null> {
  return db.one<{ id: string }>('select id from students where user_id = $1', [userId]);
}

/** شناسه دانش‌آموزانی که کاربر جاری مجاز به دیدن آن‌ها است، در همین مدرسه. */
export async function visibleStudentIds(db: Db, auth: AuthContext): Promise<'all' | string[]> {
  if (auth.permissions.has('students.manage')) return 'all';
  if (auth.role === 'teacher') {
    const rows = await db.query<{ student_id: string }>(
      `select distinct e.student_id
         from teaching_assignments ta
         join academic_years y on y.id = ta.academic_year_id and y.is_current
         join enrollments e on e.class_id = ta.class_id and e.academic_year_id = ta.academic_year_id
        where ta.teacher_user_id = $1 and ta.school_id = $2`,
      [auth.userId, auth.schoolId],
    );
    return rows.map((r) => r.student_id);
  }
  if (auth.role === 'guardian') {
    const rows = await db.query<{ student_id: string }>(
      'select student_id from student_guardians where guardian_user_id = $1',
      [auth.userId],
    );
    return rows.map((r) => r.student_id);
  }
  if (auth.role === 'student') {
    const st = await studentByUserId(db, auth.userId);
    return st ? [st.id] : [];
  }
  // نقش‌های اداری با مجوز students.read کل مدرسه را می‌بینند
  if (auth.permissions.has('students.read')) {
    const rows = await db.query<{ id: string }>('select id from students where school_id = $1', [auth.schoolId]);
    return rows.map((r) => r.id);
  }
  return [];
}

export async function assertCanViewStudent(db: Db, auth: AuthContext, studentId: string): Promise<void> {
  const st = await assertStudentInSchool(db, studentId, auth.schoolId);
  const visible = await visibleStudentIds(db, auth);
  if (visible !== 'all' && !visible.includes(st.id)) throw forbidden('دسترسی به این دانش‌آموز مجاز نیست');
}
