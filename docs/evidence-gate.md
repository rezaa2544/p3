# دروازه‌ی شواهد (Evidence Gate) — نسخه ۰.۱.۰

قاعده: هیچ ادعایی بدون **کد + آزمون + هش کامیت** پذیرفته نیست. وضعیت‌ها:
`PASS` / `FAIL` / `BLOCKED` / `NOT RUN` / `UNKNOWN`.

کامیت‌های مرجع: `3ed5816` (API)، `e59701b` (وب)، `65e4111` (رفع باگ حضور + هارنس بار)،
`46a8a4a` (بسته‌بندی + راه‌اندازی اولیه)، `3600a81` (مدیر کل تک‌مدرسه + مستندات)،
به‌علاوه‌ی کامیت سند شواهد که در انتهای همین فایل ثبت می‌شود.

## ۱. کارکردهای محصول

| ادعا | کد | آزمون | وضعیت |
|---|---|---|---|
| ورود با نام کاربری/رمز و نشست کوکی | `apps/api/src/routes/auth.ts`, `security/session.ts` | `test/auth.test.ts` (۱۱) | PASS |
| CSRF برای همه‌ی نوشتن‌ها | `apps/api/src/app.ts` → `assertCsrf` | `test/auth.test.ts` | PASS |
| نقش‌ها و مجوزها (۹ نقش) | `security/rbac.ts` | `test/access.test.ts` (۱۳) | PASS |
| مرز مدرسه با RLS | `db.ts` → `schoolTx`/`set_config`، `migrations/*` | `test/access.test.ts` → «عبور از مرز مدرسه مسدود است» | PASS |
| ثبت حضور گروهی | `routes/attendance.ts` | `test/attendance.test.ts` (۱۳) | PASS |
| اصلاح حضور با تاریخچه | `routes/attendance.ts`, `attendance_revisions` | `test/attendance.test.ts` | PASS |
| نمره، ارزیابی، تأیید | `routes/grades.ts`, `services/grading.ts` | `test/grades.test.ts` (۹) | PASS |
| کارنامه‌ی چاپی با میانگین وزنی | `routes/grades.ts`, `apps/web/src/pages/ReportCard.tsx` | `test/grades.test.ts` | PASS (منطق) / چاپ واقعی NOT RUN |
| تکالیف و ارسال | `routes/assignments.ts` | `test/comms.test.ts` | PASS |
| اطلاعیه و اعلان | `routes/comms.ts`, `queue/worker.ts` | `test/comms.test.ts` | PASS |
| پیوست فایل با محدودیت نوع/حجم | `routes/files.ts` | `test/security.test.ts` | PASS |
| داشبورد و گزارش‌ها | `routes/reports.ts`, `apps/web/src/pages/*` | سناریوی بار + تست‌های دسترسی | PASS (پایه) |
| صف آفلاین + idempotency | `apps/web/src/lib/offline.ts`, `lib/idempotency.ts` | `test/offline.test.ts` (۶) + `offline.test.ts` وب (۱۰) | PASS |
| پشتیبان/بازیابی با checksum | `services/backup.ts`, `scripts/{backup,restore}.ts` | `test/backup.test.ts` (۵), `test/migration.test.ts` (۴) | PASS |
| مهاجرت با checksum | `db.ts` → `migrate` | `test/migration.test.ts` | PASS |
| راه‌اندازی اولیه بدون رمز پیش‌فرض | `services/first-run.ts` | `test/first-run.test.ts` (۳) | PASS |
| نسخه‌ی تک‌فایل ویندوزی/لینوکسی | `scripts/build-exe.mjs` | اجرای باینری لینوکسی و ورود واقعی | PASS (لینوکس) / ویندوز NOT RUN |
| HTML تک‌فایل | `scripts/build-standalone-html.mjs` | استخراج JS + رندر در jsdom | PASS (jsdom) / مرورگر NOT RUN |

## ۲. کیفیت

| ادعا | شاهد | وضعیت |
|---|---|---|
| آزمون API | `vitest run` → **۱۱ فایل، ۸۷ تست، ۰ خطا** | PASS |
| آزمون وب | `vitest run` → **۳ فایل، ۲۹ تست، ۰ خطا** | PASS |
| typecheck هر دو بسته | `npm run typecheck` بدون خطا | PASS |
| lint | `eslint .` بدون خطا | PASS |
| وابستگی‌های تولید بدون آسیب‌شناسی شناخته‌شده | `npm audit --omit=dev` → 0 | PASS (در تاریخ ساخت) |
| آزمون مرورگری E2E | مرورگری در محیط نیست، دانلود مسدود | NOT RUN |
| اجرای ویندوزی روی ویندوز | باینری ساخته شد، اجرا ممکن نبود | NOT RUN |
| آزمون بار | `docs/testing/load-report-2026-10-23.json` | PASS (مشورتی، روی PGlite) |

## ۳. انتشار و استقرار

| ادعا | وضعیت | توضیح |
|---|---|---|
| آدرس HTTPS عمومی محصول | **BLOCKED** | هیچ میزبان/دامنه‌ای در اختیار نبود؛ ارائه‌ی URL ساختگی ممنوع |
| ساخت دارایی‌ها (EXE/Linux/HTML) | PASS | ساخته و هش شدند؛ `artifacts/BUILD.md` |
| آپلود دارایی در GitHub Release | **BLOCKED** | میزبان `uploads.github.com` از این محیط در دسترس نیست؛ HTML در مخزن قرار گرفت و باینری‌ها با `npm run artifact:exe` بازتولید می‌شوند |
| APK اندروید | **BLOCKED** | بدون Android SDK/JDK و بدون دسترسی به دانلود آن‌ها |
| نصب‌کننده‌ی (installer) ویندوز | **NOT BUILT** | نیازمند NSIS/WiX + امضا؛ نسخه‌ی تک‌فایل جایگزین شد |
| اجرای CI | **PASS** | GitHub Actions، workflow «CI»، اجرای [39992723557](https://github.com/rezaa2544/p3/actions/runs/39992723557): هر دو کار (typecheck/lint/test/build و audit وابستگی تولیدی) سبز. اجرای قبلی به‌دلیل خطای lint روی خروجی ساخت (dist-standalone) شکست خورد و با اصلاح پیکربندی eslint رفع شد |

## ۴. باگ واقعی کشف‌شده و رفع‌شده (نمونه‌ی صداقت شواهد)

| مورد | جزئیات |
|---|---|
| نشانه | آزمون بار: ۱۰۰٪ درخواست‌های ثبت گروهی حضور `non2xx` |
| ریشه | ایندکس یکتای `attendance_client_op` فقط روی `client_op_id` بود؛ یک کلید برای ۳۰ دانش‌آموز → نقض یکتایی |
| رفع | `unique (client_op_id, student_id) where client_op_id is not null` (کامیت `65e4111`) |
| شاهد | آزمون «رجیستری: ثبت گروهی با یک کلید عملیات» + بازاجرای بار با `statusCodes: {201: 1129}` |

## ۵. داوری نهایی

**READY FOR LIMITED PILOT**

دلیل: کارکردهای اصلی (حضور، نمره، کارنامه، تکلیف، اطلاعیه، گزارش، نقش‌ها، آفلاین، پشتیبان)
با ۱۱۶ آزمون خودکار و اجرای واقعی همان بسته روی یک باینری مستقل تأیید شده‌اند. اما سه چیز
مانع «READY FOR USE» است و به‌صراحت اعلام می‌شود:

1. هیچ استقرار اینترنتی با TLS و دامنه انجام نشده (BLOCKED).
2. E2E مرورگری و آزمون آفلاین واقعی انجام نشده (NOT RUN).
3. APK و installer ویندوز ارائه نشده (BLOCKED / NOT BUILT).

پیش‌شرط‌های پایلوت محدود: استفاده‌ی داخلی در یک مدرسه، با پشتیبان روزانه‌ی آزمون‌شده،
دسترسی از طریق شبکه‌ی محلی یا VPN، و پذیرش این نکته که داده‌ی دانش‌آموز روی یک رایانه
نگه‌داری می‌شود (نسخه‌ی ویندوزی).
