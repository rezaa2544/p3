# معماری سامانه — پایش ۲

## ۱. نمای کلی

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│ React 19 + Vite PWA      │  HTTPS │ Fastify 5 (apps/api)          │
│ RTL فارسی، IndexedDB     │ ─────► │ /api/*  (۸۳ مسیر)             │
│ صف آفلاین + Service Worker│        │ احراز نشست، CSRF، RBAC، نرخ   │
└──────────────────────────┘        └──────────────┬────────────────┘
                                                   │ pg (SQL خام)
                                    ┌──────────────▼────────────────┐
                                    │ PostgreSQL 15+ (prod)         │
                                    │ یا PGlite روی wire protocol   │
                                    │ RLS + set_config در هر تراکنش │
                                    └──────────────┬────────────────┘
                                                   │
                                    ┌──────────────▼────────────────┐
                                    │ worker: outbox_jobs, اعلان‌ها  │
                                    └───────────────────────────────┘
```

- یک باینری/فرآیند Node، دو نقش: سرور API و سرو‌کننده‌ی SPA ساخته‌شده از `apps/web/dist`.
- هیچ وابستگی به سرویس ابری تجاری وجود ندارد؛ همه‌چیز روی یک ماشین + PostgreSQL قابل اجراست.

## ۲. اجزای کد

| مسیر | مسئولیت |
|---|---|
| `apps/api/src/app.ts` | ساخت Fastify، هدرهای امنیتی، مسیرها با پیشوند `/api`، سرو SPA |
| `apps/api/src/security/session.ts` | نشست کوکی، CSRF، دامنه‌ی مدرسه، نقش مؤثر |
| `apps/api/src/security/rbac.ts` | ماتریس نقش→مجوز |
| `apps/api/src/db.ts` | pool، `schoolTx` با `set_config`، `migrate` با checksum |
| `apps/api/src/routes/*` | health, auth, school, people, attendance, grades, assignments, comms, reports, files |
| `apps/api/src/queue/worker.ts` | پردازش `outbox_jobs` (اعلان‌ها، کارهای پس‌زمینه) |
| `apps/api/src/services/grading.ts` | میانگین وزنی درس، وضعیت قبولی، قواعد کارنامه |
| `apps/api/src/services/backup.ts` | پشتیبان متنی + manifest/checksum، بازیابی، `restoreIntoEmptyDatabase` |
| `apps/api/src/services/first-run.ts` | راه‌اندازی اولیه‌ی امن (بدون رمز پیش‌فرض عمومی) |
| `apps/web/src/lib/offline.ts` | صف IndexedDB، ارسال دوباره، نمایش وضعیت |
| `apps/web/src/pages/*` | ۱۴ صفحه‌ی فارسی/RTL |

## ۳. مرز مدرسه (multi-tenancy)

- هر جدول آموزشی `school_id` دارد؛ RLS با `current_setting('app.school_id')` فعال است.
- `schoolTx(scope, fn)` در یک اتصال تراکنشی `set_config('app.school_id', …, is_local=true)`
  را اجرا می‌کند؛ بنابراین scope به‌صورت thread-local (AsyncLocalStorage) در همان تراکنش
  جاری است و کوئری بیرون از آن با خطا رد می‌شود (`q()` بدون scope → خطا).
- مدیر کل (`is_super_admin`) با هدر `X-School-Id` مدرسه را انتخاب می‌کند؛ اگر فقط یک عضویت
  داشته باشد بدون هدر هم ادامه می‌دهد (نصب تک‌مدرسه‌ای).

## ۴. جریان یک ثبت حضور (مسیر داغ)

1. مرورگر: `POST /api/attendance` با `Idempotency-Key` یکتا.
2. `resolveAuth` → نشست + نقش + مدرسه.
3. `assertCsrf` روی همه‌ی متدهای غیر-GET.
4. بررسی مجوز `attendance.write` و تخصیص دبیر به کلاس/درس در همان سال تحصیلی.
5. در `schoolTx`: درج/به‌روزرسانی `attendance_records` (کلید یکتا: `client_op_id` + `student_id`)،
   ثبت `audit_log` و پاسخ ۲۰۱ با داده‌ی ذخیره‌شده.
6. اگر همان `Idempotency-Key` دوباره برسد، پاسخ ذخیره‌شده در `idempotency_keys` بازگردانده
   می‌شود (بدون درج تکراری).

## ۵. چرا این انتخاب‌ها

| تصمیم | دلیل | سند |
|---|---|---|
| TypeScript + Fastify + SQL خام | کنترل کامل روی تراکنش، RLS و کارایی؛ ORM سنگین لازم نیست | `docs/decisions/0001-stack.md` |
| PGlite در توسعه/CI | PostgreSQL واقعی بدون نصب سرویس؛ تست‌ها همان SQL تولید را اجرا می‌کنند | `0001` |
| کوکی نشست مبهم + CSRF | ساده، قابل ابطال، بدون نگه‌داری توکن در localStorage | `docs/security/01-threat-model.md` |
| کلید یکتای عملیات در دیتابیس | امنیت در برابر تکرار در سطح داده، نه فقط کلاینت | `0002-offline-idempotency.md` |
| بسته‌بندی SEA برای ویندوز | نصب بدون Node/npm روی رایانه‌ی مدرسه | `0003-packaging.md` |

## ۶. مقیاس و نقاط اشباع

- تنگناها به ترتیب: کوئری داشبورد (تجمیع چند جدول)، نوشتن نمره (تراکنش بزرگ‌تر)،
  فهرست کلاس (کوئری ساده با ایندکس).
- روی PGlite (تک‌اتصال، بدون موازی‌سازی واقعی) اعداد پایین‌تر از PostgreSQL مدیریت‌شده است؛
  اعداد اندازه‌گیری‌شده و تفسیر آن‌ها در `docs/testing/01-strategy.md` آمده است.
- مسیر رشد: PostgreSQL مدیریت‌شده؛ ایندکس‌های موجود `attendance_school_day` (school_id, day)،
  `attendance_class_day` (class_id, day, period_no)، `grades_student` (student_id) و
  `assessments_assignment` (teaching_assignment_id, term_id) کافی‌اند؛ سپس در صورت نیاز
  کش خواندن برای داشبورد.
