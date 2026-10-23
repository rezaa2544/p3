# کنترل دسترسی — ماتریس نقش و مجوز

منبع حقیقت کد: `apps/api/src/security/rbac.ts`
تست‌های مرتبط: `apps/api/test/access.test.ts` (۱۳ تست)، `apps/api/test/security.test.ts` (۹ تست)

## ۱. مجوزها

`school.read`, `school.manage`, `users.read`, `users.manage`, `students.read`,
`students.manage`, `attendance.read`, `attendance.write`, `attendance.correct`,
`grades.read`, `grades.write`, `grades.approve`, `assignments.read`, `assignments.manage`,
`comms.read`, `comms.manage`, `reports.read`, `audit.read`, `files.upload`, `system.health`

## ۲. ماتریس نقش → مجوز

| مجوز | org_admin | school_admin | vice_principal | it_operator | teacher | counselor | finance | student | guardian |
|---|---|---|---|---|---|---|---|---|---|
| school.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| school.manage | ✓ | ✓ | – | – | – | – | – | – | – |
| users.read | ✓ | ✓ | – | ✓ | – | – | – | – | – |
| users.manage | ✓ | ✓ | – | ✓ | – | – | – | – | – |
| students.read | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| students.manage | – | ✓ | ✓ | – | – | – | – | – | – |
| attendance.read | – | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ |
| attendance.write | – | ✓ | ✓ | – | ✓ | – | – | – | – |
| attendance.correct | – | ✓ | ✓ | – | – | – | – | – | – |
| grades.read | – | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ |
| grades.write | – | – | – | – | ✓ | – | – | – | – |
| grades.approve | – | ✓ | ✓ | – | – | – | – | – | – |
| assignments.read | – | – | – | – | ✓ | – | – | ✓ | ✓ |
| assignments.manage | – | – | – | – | ✓ | – | – | – | – |
| comms.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| comms.manage | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – |
| reports.read | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| audit.read | ✓ | ✓ | – | ✓ | – | – | – | – | – |
| files.upload | – | ✓ | ✓ | – | ✓ | – | – | – | – |
| system.health | – | ✓ | – | ✓ | – | – | – | – | – |

`org_admin` مجموعه‌ی `STAFF_CORE` (school.read، students.read، reports.read) را هم دارد.
`is_super_admin` همه‌ی مجوزها را دارد و دامنه‌اش را با `X-School-Id` تعیین می‌کند.

## ۳. محدودیت مالکیت (self-scope)

علاوه بر مجوز، نقش‌های `student` و `guardian` فقط به داده‌ی خودشان/فرزندشان دسترسی دارند
(`isSelfScopedRole`). این محدودیت در کوئری‌ها اعمال می‌شود و در تست
«دانش‌آموز نمی‌تواند حضور یا نمره ثبت کند و داده دیگری را ببیند» و «ولی فقط فرزند خود را می‌بیند» پوشش دارد.

## ۴. قواعد اضافی

- `grades.approve`: نمره تا تأیید، در کارت گزارش دانش‌آموز/والد ظاهر نمی‌شود
  (تست: `grades.test.ts` → «نمره تا تأیید نشدن برای دانش‌آموز و ولی دیده نمی‌شود»).
- دبیر فقط برای کلاس/درس تخصیص‌یافته در سال تحصیلی جاری می‌نویسد (`teaching_assignments`).
- دانلود فایل با بررسی `school_id` و مجوز؛ تست «دانلود فایل بین مدارس و برای کاربر نامرتبط مسدود است».
- اصلاح حضور فقط با مجوز `attendance.correct` و همیشه با ثبت نسخه‌ی قبلی در
  `attendance_revisions` + رویداد حسابرسی.
