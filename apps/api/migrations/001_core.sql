-- PAYESH 2 — 001 core schema
-- همه‌ی جدول‌ها UUID دارند و مرز مدرسه (school_id) در تمام داده‌های آموزشی حاضر است.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now(),
  checksum text not null
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table schools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete restrict,
  name text not null,
  code text not null unique,
  city text,
  timezone text not null default 'Asia/Tehran',
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  title text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint academic_years_dates check (ends_on > starts_on),
  unique (school_id, title)
);
create unique index academic_years_one_current on academic_years(school_id) where is_current;

create table terms (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  title text not null,
  seq smallint not null,
  starts_on date not null,
  ends_on date not null,
  unique (academic_year_id, seq),
  constraint terms_dates check (ends_on > starts_on)
);

create table grade_levels (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  title text not null,
  seq smallint not null,
  unique (school_id, title)
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  grade_level_id uuid references grade_levels(id) on delete set null,
  title text not null,
  capacity smallint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (academic_year_id, title)
);

create table subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  title text not null,
  code text not null,
  weekly_hours smallint,
  unique (school_id, code)
);

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  email text,
  password_hash text not null,
  full_name text not null,
  phone text,
  national_id text,
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  must_change_password boolean not null default false,
  mfa_enabled boolean not null default false,
  mfa_secret text,
  failed_attempts smallint not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_lower on users(lower(email)) where email is not null;
create unique index users_national_id on users(national_id) where national_id is not null;

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  unique (user_id, school_id, role),
  constraint memberships_role check (role in (
    'org_admin','school_admin','vice_principal','it_operator',
    'teacher','counselor','finance','student','guardian'
  ))
);
create index memberships_school_role on memberships(school_id, role);

create table students (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  user_id uuid unique references users(id) on delete set null,
  first_name text not null,
  last_name text not null,
  national_id text,
  birth_date date,
  gender text check (gender in ('male','female')),
  status text not null default 'active' check (status in ('active','inactive','graduated','transferred')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index students_national_id_per_school on students(school_id, national_id) where national_id is not null;
create index students_school on students(school_id);

create table student_guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  guardian_user_id uuid not null references users(id) on delete cascade,
  relation text not null check (relation in ('father','mother','other')),
  is_primary boolean not null default false,
  can_view_grades boolean not null default true,
  can_view_attendance boolean not null default true,
  unique (student_id, guardian_user_id)
);
create index student_guardians_user on student_guardians(guardian_user_id);

create table teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  teacher_user_id uuid not null references users(id) on delete cascade,
  unique (academic_year_id, class_id, subject_id),
  unique (id, school_id)
);
create index teaching_assignments_teacher on teaching_assignments(teacher_user_id, academic_year_id);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  class_id uuid not null references classes(id) on delete restrict,
  status text not null default 'enrolled' check (status in ('enrolled','withdrawn','transferred','graduated')),
  enrolled_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (student_id, academic_year_id)
);
create index enrollments_class on enrollments(class_id, academic_year_id);

create table bell_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  period_no smallint not null,
  starts_at time not null,
  ends_at time not null,
  unique (school_id, period_no)
);

create table timetable (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  period_no smallint not null,
  subject_id uuid not null references subjects(id) on delete cascade,
  teacher_user_id uuid references users(id) on delete set null,
  room text,
  unique (class_id, academic_year_id, weekday, period_no)
);

create table calendar_days (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('holiday','exam','event','compensatory')),
  title text not null,
  unique (school_id, day)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  csrf_token text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_user on sessions(user_id);

create table login_attempts (
  id bigserial primary key,
  identifier text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_identifier on login_attempts(identifier, created_at desc);

create table idempotency_keys (
  key text primary key,
  user_id uuid not null references users(id) on delete cascade,
  endpoint text not null,
  request_hash text not null,
  status_code int not null,
  response jsonb,
  created_at timestamptz not null default now()
);
create index idempotency_created on idempotency_keys(created_at);
