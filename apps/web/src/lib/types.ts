export type Membership = { schoolId: string; schoolName: string; role: string };

export type Me = {
  user: { id: string; fullName: string; isSuperAdmin: boolean; mustChangePassword: boolean; mfaEnabled: boolean };
  activeSchoolId: string;
  role: string;
  roles: string[];
  permissions: string[];
  memberships: Membership[];
  csrfToken: string | null;
};

export type School = { id: string; name: string; code: string; city: string | null; timezone: string };
export type AcademicYear = { id: string; title: string; starts_on: string; ends_on: string; is_current: boolean };
export type Klass = {
  id: string;
  title: string;
  capacity: number | null;
  is_active: boolean;
  academic_year_id: string;
  grade_level: string | null;
  students: number;
};
export type Subject = { id: string; title: string; code: string; weekly_hours: number | null };
export type Term = { id: string; title: string; seq: number; academic_year_id: string; starts_on: string; ends_on: string };

export type Student = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  class_id: string | null;
  class_title: string | null;
};

export type AttendanceRecord = {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  day: string;
  period_no: number;
  status: string;
  note: string | null;
  source: 'online' | 'offline';
  recorded_at: string;
  captured_at: string | null;
  recorded_by_name: string;
};

export type StudentListItem = Student;

export type StudentList = { items: Student[]; total: number; page: number; limit: number };

export type StudentDetail = {
  student: Student & { gender: string | null; birth_date: string | null; user_id: string | null; academic_year_id?: string | null };
  guardians: {
    id: string;
    guardian_user_id: string;
    full_name: string;
    phone: string | null;
    relation: string;
    is_primary: boolean;
    can_view_grades: boolean;
    can_view_attendance: boolean;
  }[];
};

export type Assessment = {
  id: string;
  title: string;
  kind: string;
  max_score: string | number;
  weight: string | number;
  held_on: string | null;
  status: 'draft' | 'published' | 'closed';
  class_id: string;
  class_title: string;
  subject_id: string;
  subject_title: string;
  teacher_user_id: string;
  grade_count: number;
};

export type GradeRow = {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  score: string | number | null;
  status: 'draft' | 'submitted' | 'approved';
  updated_at: string;
};

export type ReportCard = {
  student: { id: string; first_name: string; last_name: string };
  subjects: {
    subjectId: string;
    subjectTitle: string;
    average: number | null;
    counted: number;
    missing: number;
    excluded: number;
    totalWeight: number;
    complete: boolean;
    result: 'pass' | 'fail' | 'incomplete' | 'no-data';
    assessments: { id: string; title: string; maxScore: number; weight: number; score: number | null; status: string; approved: boolean }[];
  }[];
  overall: {
    average: number | null;
    hasData: boolean;
    complete: boolean;
    subjectsWithData: number;
    subjectsTotal: number;
  };
  dataNotice: string | null;
};

export type Assignment = {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  published_at: string | null;
  allow_submission: boolean;
  max_score: string | number | null;
  class_title: string;
  subject_title: string;
  class_id: string;
};

export type Submission = {
  id: string;
  student_id?: string;
  first_name?: string;
  last_name?: string;
  body?: string | null;
  status: string;
  submitted_at: string;
  score: string | number | null;
  feedback: string | null;
};

export type Announcement = {
  id: string;
  title: string;
  body: string;
  audience: 'all' | 'class' | 'role';
  target_class_id: string | null;
  target_role: string | null;
  published_at: string | null;
  created_at: string;
  created_by_name: string;
  is_read: boolean;
};

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type UserRow = {
  id: string;
  username: string;
  full_name: string;
  is_active: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  last_login_at: string | null;
  role: string;
};

export type Options = {
  classes: { id: string; title: string }[];
  subjects: { id: string; title: string; code: string }[];
  terms: { id: string; title: string; academic_year_id: string }[];
  attendanceStatuses: { value: string; label: string }[];
  today: string;
};

export type DashboardAdmin = {
  role: string;
  date: string;
  stats: {
    students: number;
    active_students: number;
    classes: number;
    staff: number;
    teachers: number;
    attendanceRecordedToday: number;
    attendanceByStatus: { status: string; label: string; count: number }[];
    absentStudentsToday: number;
    gradesPendingApproval: number;
    hasAttendanceDataToday: boolean;
  };
  classesWithoutAttendanceToday: { id: string; title: string }[];
  recentActivity: { id: number; action: string; entity: string; created_at: string; actor_name: string | null }[];
};

export type DashboardTeacher = {
  role: 'teacher';
  date: string;
  classesToday: { class_id: string; class_title: string; subject_title: string; period_no: number | null }[];
  pendingAttendance: { class_id: string; class_title: string; period_no: number }[];
  pendingAttendanceCount: number;
  draftAssessments: number;
  upcomingAssignments: { id: string; title: string; due_at: string; class_title: string }[];
};

export type DashboardStudent = {
  role: 'student';
  enrolled: boolean;
  upcomingAssignments: { id: string; title: string; due_at: string; subject_title: string }[];
  unreadNotifications?: number;
};

export type DashboardGuardian = {
  role: 'guardian';
  children: { id: string; first_name: string; last_name: string; class_title: string | null }[];
  attendanceLast30Days: { student_id: string; status: string; n: number }[];
  unreadNotifications: number;
};

export type Dashboard = DashboardAdmin | DashboardTeacher | DashboardStudent | DashboardGuardian;

export type AuditRow = {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  ip: string | null;
  request_id: string | null;
};
