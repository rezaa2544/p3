# پایگاه داده — ساختار و قواعد

دو مهاجرت اعمال‌شده: `001_core.sql` و `002_education.sql` (checksum هر مهاجرت در
`schema_migrations` نگه‌داری می‌شود؛ تغییر فایل مهاجرت پس از اعمال = خطای راه‌اندازی).

## ۱. گروه‌بندی جدول‌ها

| گروه | جدول‌ها |
|---|---|
| سازمان و مدرسه | `organizations`, `schools`, `academic_years`, `terms`, `grade_levels`, `classes`, `bell_periods`, `calendar_days` |
| هویت و دسترسی | `users`, `memberships`, `sessions`, `login_attempts` |
| افراد | `students`, `student_guardians`, `enrollments` |
| آموزش | `subjects`, `teaching_assignments`, `timetable`, `assessments`, `grades`, `grade_revisions` |
| حضور | `attendance_records`, `attendance_revisions` |
| تکلیف و ارتباط | `assignments`, `assignment_submissions`, `announcements`, `announcement_reads`, `notifications` |
| زیرساخت | `files`, `idempotency_keys`, `outbox_jobs`, `audit_log` |

## ۲. اصول طراحی

1. **UUID همه‌جا**: شناسه‌ها قابل حدس نیستند و ادغام/انتقال داده ساده است.
2. **مرز مدرسه**: همه‌ی جدول‌های آموزشی `school_id` دارند و RLS با
   `current_setting('app.school_id')` اعمال می‌شود.
3. **تاریخ**: تاریخ روزانه `date` (بدون ساعت) و لحظه‌ها `timestamptz`؛ نمایش جلالی در رابط.
4. **نرم‌افزاری بدون حذف فیزیکی داده‌ی آموزشی**: نمره و حضور با revision نگه‌داری می‌شوند.
5. **یکتایی معنادار**: مثلاً حضور هر دانش‌آموز در یک روز/زنگ یکتا؛ نمره در هر ارزیابی یکتا.

## ۳. ایندکس‌های مهم

| ایندکس | جدول | کاربرد |
|---|---|---|
| `attendance_school_day` | attendance_records(school_id, day) | داشبورد و گزارش روزانه |
| `attendance_class_day` | attendance_records(class_id, day, period_no) | فهرست کلاس و اصلاح |
| `attendance_client_op` (یکتا) | attendance_records(client_op_id, student_id) where not null | جلوگیری از درج تکراری در همگام‌سازی |
| `attendance_student_day` | attendance_records(student_id, day desc) | نمای والد/دانش‌آموز |
| `assessments_assignment` | assessments(teaching_assignment_id, term_id) | کارنامه |
| `grades_student` | grades(student_id) | کارنامه‌ی دانش‌آموز |
| `enrollments_class` | enrollments(class_id, academic_year_id) | فهرست کلاس |
| `teaching_assignments_teacher` | teaching_assignments(teacher_user_id, academic_year_id) | دامنه‌ی دبیر |
| `outbox_pending` | outbox_jobs(status, run_after) where pending | worker |
| `audit_school_time` | audit_log(school_id, created_at desc) | حسابرسی |

> نکته‌ی واقعی از توسعه: ایندکس یکتای حضور ابتدا فقط روی `client_op_id` بود. چون کلاینت
> برای یک ثبت گروهی **یک** کلید عملیات می‌فرستد، هر نوشتن گروهی با نقض یکتایی شکست می‌خورد.
> اصلاح: یکتایی روی `(client_op_id, student_id)`؛ تست `رجیستری: ثبت گروهی با یک کلید عملیات`.

## ۴. `idempotency_keys`

- ستون‌ها: `key` (کلید یکتا، همان مقدار هدر `Idempotency-Key`), `user_id`, `endpoint`,
  `request_hash`, `status_code`, `response`, `created_at`.
- مسیرهای نوشتن حساس (حضور) کلید را اجباری می‌کنند؛ تکرار همان کلید = بازگرداندن پاسخ
  ذخیره‌شده با هدر `Idempotent-Replayed: true` (بدون درج دوباره).
- اگر همان کلید با بدنه‌ی متفاوت بیاید، `request_hash` تفاوت را نشان می‌دهد و درخواست
  به‌عنوان تعارض رد می‌شود (نه بازنویسی).
- پاک‌سازی: رکوردهای قدیمی با `idempotency_created` قابل حذف دوره‌ای هستند (پیشنهاد: ۳۰ روز).

## ۵. قاعده‌ی مهاجرت

- هر تغییر ساختاری = فایل جدید در `apps/api/migrations/` با شماره‌ی بعدی؛ **هرگز** فایل
  اعمال‌شده را تغییر ندهید (checksum رد می‌کند؛ در تولید باید مهاجرت جدید بنویسید).
- مهاجرت باید idempotent نوشته شود (`if not exists`, `on conflict`).
- تست‌های `migration.test.ts` اجرای مهاجرت روی دیتابیس خالی، checksum و بازیابی از
  پشتیبان را می‌سنجند.

## ۶. پشتیبان‌گیری داده

- `npm run db:backup` → فایل‌های متنی + `manifest.json` با sha256 هر فایل.
- `npm run db:restore` → بررسی checksum، بازگردانی در تراکنش، `restoreIntoEmptyDatabase`
  برای راه‌اندازی محیط تازه.
- برای PostgreSQL مدیریت‌شده، `pg_dump`/`pg_restore` هم پشتیبانی می‌شود؛ اما مسیر تست‌شده
  در ۰.۱.۰ همان اسکریپت‌های بالا است.
