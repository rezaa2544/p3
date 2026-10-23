export const ROLES = [
  'org_admin',
  'school_admin',
  'vice_principal',
  'it_operator',
  'teacher',
  'counselor',
  'finance',
  'student',
  'guardian',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'school.read',
  'school.manage',
  'users.read',
  'users.manage',
  'students.read',
  'students.manage',
  'attendance.read',
  'attendance.write',
  'attendance.correct',
  'grades.read',
  'grades.write',
  'grades.approve',
  'assignments.read',
  'assignments.manage',
  'comms.read',
  'comms.manage',
  'reports.read',
  'audit.read',
  'files.upload',
  'system.health',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_CORE: Permission[] = ['school.read', 'students.read', 'reports.read'];

/**
 * ماتریس مجوز نقش‌ها. هر تغییر باید در docs/security/access-control.md و تست‌های
 * apps/api/test/security.test.ts منعکس شود.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  org_admin: [...STAFF_CORE, 'school.manage', 'users.read', 'users.manage', 'audit.read', 'comms.read', 'comms.manage'],
  school_admin: [
    ...STAFF_CORE,
    'school.manage',
    'users.read',
    'users.manage',
    'students.manage',
    'attendance.read',
    'attendance.write',
    'attendance.correct',
    'grades.read',
    'grades.approve',
    'assignments.read',
    'comms.read',
    'comms.manage',
    'audit.read',
    'files.upload',
    'system.health',
  ],
  vice_principal: [
    ...STAFF_CORE,
    'students.manage',
    'attendance.read',
    'attendance.write',
    'attendance.correct',
    'grades.read',
    'grades.approve',
    'assignments.read',
    'comms.read',
    'comms.manage',
    'files.upload',
  ],
  it_operator: ['school.read', 'users.read', 'users.manage', 'audit.read', 'system.health', 'comms.read'],
  teacher: [
    'school.read',
    'students.read',
    'attendance.read',
    'attendance.write',
    'grades.read',
    'grades.write',
    'assignments.read',
    'assignments.manage',
    'comms.read',
    'comms.manage',
    'reports.read',
    'files.upload',
  ],
  counselor: ['school.read', 'students.read', 'attendance.read', 'grades.read', 'reports.read', 'comms.read'],
  finance: ['school.read', 'students.read', 'reports.read', 'comms.read'],
  student: ['assignments.read', 'grades.read', 'attendance.read', 'comms.read'],
  guardian: ['assignments.read', 'grades.read', 'attendance.read', 'comms.read'],
};

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) {
    const list = ROLE_PERMISSIONS[r as Role];
    if (list) for (const p of list) out.add(p);
  }
  return out;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** نقش‌هایی که داده‌شان محدود به مالکیت/رابطه است (نه کل مدرسه). */
export function isSelfScopedRole(role: string): boolean {
  return role === 'student' || role === 'guardian' || role === 'teacher';
}
