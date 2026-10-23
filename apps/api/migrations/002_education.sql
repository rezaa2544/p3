-- PAYESH 2 — 002 آموزش: حضور و غیاب، نمرات، تکالیف، ارتباطات، صف، audit

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  day date not null,
  period_no smallint not null default 0,
  status text not null check (status in ('present','absent','late','early_leave','excused','sick')),
  note text,
  recorded_by uuid not null references users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  client_op_id text,
  source text not null default 'online' check (source in ('online','offline')),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, day, period_no)
);
-- یک کلید عملیات (Idempotency-Key) برای یک دسته ثبت گروهی استفاده می‌شود؛
-- بنابراین یکتایی باید ترکیبی با دانش‌آموز باشد، نه روی خود کلید.
create unique index attendance_client_op on attendance_records(client_op_id, student_id) where client_op_id is not null;
create index attendance_class_day on attendance_records(class_id, day, period_no);
create index attendance_school_day on attendance_records(school_id, day);
create index attendance_student_day on attendance_records(student_id, day desc);

create table attendance_revisions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references attendance_records(id) on delete cascade,
  changed_by uuid not null references users(id) on delete restrict,
  old_status text not null,
  new_status text not null,
  reason text not null,
  changed_at timestamptz not null default now()
);
create index attendance_revisions_record on attendance_revisions(record_id, changed_at desc);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  term_id uuid not null references terms(id) on delete restrict,
  teaching_assignment_id uuid not null references teaching_assignments(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('quiz','midterm','final','oral','project','other')),
  max_score numeric(5,2) not null default 20 check (max_score > 0),
  weight numeric(5,2) not null default 1 check (weight > 0),
  held_on date,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index assessments_assignment on assessments(teaching_assignment_id, term_id);

create table grades (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  score numeric(5,2) check (score >= 0),
  status text not null default 'draft' check (status in ('draft','submitted','approved')),
  entered_by uuid not null references users(id) on delete restrict,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);
create index grades_student on grades(student_id);

create table grade_revisions (
  id uuid primary key default gen_random_uuid(),
  grade_id uuid not null references grades(id) on delete cascade,
  changed_by uuid not null references users(id) on delete restrict,
  old_score numeric(5,2),
  new_score numeric(5,2),
  old_status text,
  new_status text,
  reason text not null,
  changed_at timestamptz not null default now()
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id) on delete cascade,
  teaching_assignment_id uuid not null references teaching_assignments(id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz not null,
  max_score numeric(5,2),
  allow_submission boolean not null default true,
  published_at timestamptz,
  created_by uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index assignments_teaching on assignments(teaching_assignment_id, due_at desc);

create table assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  body text,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted','late','reviewed','returned')),
  score numeric(5,2),
  feedback text,
  reviewed_by uuid references users(id) on delete set null,
  unique (assignment_id, student_id)
);

create table files (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  owner_user_id uuid not null references users(id) on delete restrict,
  storage_key text not null unique,
  original_name text not null,
  mime text not null,
  size_bytes integer not null check (size_bytes >= 0),
  sha256 text not null,
  entity text,
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index files_entity on files(entity, entity_id);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  academic_year_id uuid references academic_years(id) on delete set null,
  title text not null,
  body text not null,
  audience text not null default 'all' check (audience in ('all','class','role')),
  target_class_id uuid references classes(id) on delete cascade,
  target_role text,
  created_by uuid not null references users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index announcements_school on announcements(school_id, created_at desc);

create table announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  school_id uuid not null references schools(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on notifications(user_id, created_at desc);

create table outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts smallint not null default 0,
  max_attempts smallint not null default 5,
  run_after timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbox_pending on outbox_jobs(status, run_after) where status = 'pending';

create table audit_log (
  id bigserial primary key,
  school_id uuid references schools(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  actor_role text,
  action text not null,
  entity text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip text,
  user_agent text,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_school_time on audit_log(school_id, created_at desc);
create index audit_actor on audit_log(actor_user_id, created_at desc);
