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
| ثبت حضور گروهی | `routes/attendance.ts` | `test/attendance.test.ts` (۱۵) + E2E مرورگر واقعی | PASS |
| اصلاح حضور با تاریخچه (رابط کاربری + `GET /attendance/:id/revisions`) | `routes/attendance.ts`, `apps/web/src/pages/Attendance.tsx`, `attendance_revisions` | `test/attendance.test.ts` (۲ تست اختصاصی) + E2E «اصلاح حضور» | PASS |
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
| HTML تک‌فایل (باز شدن با file://) | `apps/web/src/pages/StandaloneGuide.tsx`, `apps/web/src/main.tsx` | `StandaloneGuide.test.tsx` (۳) + E2E مرورگر واقعی | PASS |
| سرو رابط کاربری و مسیرهای SPA (رفرش روی /login، /attendance) | `apps/api/src/app.ts` (resolver مسیر + `/*`) | `test/web-static.test.ts` (۴) | PASS |
| HTML تک‌فایل (سرو از سرور و ورود کامل) | `apps/api/src/app.ts` → `/standalone.html` | `standalone.test.ts` (۳) + E2E مرورگر واقعی (۷/۷) | PASS |

## ۲. کیفیت

| ادعا | شاهد | وضعیت |
|---|---|---|
| آزمون API | `vitest run` → **۱۳ فایل، ۹۶ تست، ۰ خطا** | PASS |
| آزمون وب | `vitest run` → **۴ فایل، ۳۳ تست، ۰ خطا** (شامل تست پایداری فوکوس مودال) | PASS |
| typecheck هر دو بسته | `npm run typecheck` بدون خطا | PASS |
| lint | `eslint .` بدون خطا | PASS |
| وابستگی‌های تولید بدون آسیب‌شناسی شناخته‌شده | `npm audit --omit=dev` → 0 | PASS (در تاریخ ساخت) |
| آزمون مرورگری E2E (نسخه‌ی HTML تک‌فایل) | Chromium headless ۱۳۱، ۷/۷ PASS — `docs/testing/standalone-e2e.json` | PASS |
| آزمون مرورگری E2E (کل جریان‌های محصول: حضور، اصلاح، نمره، کارنامه/PDF، تکلیف، اطلاعیه، RBAC، آفلاین، PWA) | Chromium ۱۳۱ → **۲۳/۲۳ PASS** — `docs/testing/product-e2e.json`، `docs/testing/03-product-e2e.md` | PASS |
| قطع واقعی شبکه و همگام‌سازی idempotent در مرورگر | CDP `setOfflineMode` → صف محلی → بازگشت شبکه → «تأیید سرور»؛ سرور رکورد را `offline` ثبت کرد | PASS |
| PWA: بارگذاری پوسته در حالت آفلاین | سرویس‌ورکر فعال + reload آفلاین موفق — `product-pwa-offline.png` | PASS |
| بازبینی ایستای فایل اجرایی ویندوز | `npm run verify:win` → ۷/۷ (PE32+ x64، SEA شامل HTML) — `artifacts/payesh2-win-static.json` | PASS |
| اجرای ویندوزی روی ویندوز واقعی | باینری ساخته شد، اجرا ممکن نبود | NOT RUN |
| اجرای بسته‌بندی‌شده (همان کد ویندوز) روی لینوکس | `artifacts/payesh2` → health ok، `/standalone.html` ۲۰۰، راه‌اندازی اولیه با رمز تصادفی، ورود موفق، صفر خطای کنسول | PASS (لینوکس) |
| آزمون بار | `docs/testing/load-report-2026-10-23.json` | PASS (مشورتی، روی PGlite) |

## ۳. انتشار و استقرار

| ادعا | وضعیت | توضیح |
|---|---|---|
| آدرس HTTPS عمومی محصول | **BLOCKED** | هیچ میزبان/دامنه‌ای در اختیار نبود؛ ارائه‌ی URL ساختگی ممنوع |
| ساخت دارایی‌ها (EXE/Linux/HTML) | PASS | ساخته و هش شدند؛ `artifacts/BUILD.md` |
| دانلود مستقیم دارایی‌ها از مخزن | **PASS** | `artifacts/payesh2-standalone-html.zip`، `artifacts/payesh2-win-x64.zip`، `artifacts/payesh2-standalone.html` با لینک `raw` (هش‌ها در `artifacts/BUILD.md`) |
| آپلود دارایی در GitHub Release | **BLOCKED** | میزبان `uploads.github.com` از این محیط پاسخ نمی‌دهد (بررسی `curl` → 000) |
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
با ۱۲۹ آزمون خودکار (۹۶ API + ۳۳ وب) و ۳۰ بررسی E2E در مرورگر واقعی (۷ تک‌فایل + ۲۳ جریان
محصول، شامل قطع واقعی شبکه) تأیید شده‌اند. سه چیز مانع «READY FOR USE» است و به‌صراحت
اعلام می‌شود:

1. هیچ استقرار اینترنتی با TLS و دامنه انجام نشده (BLOCKED).
2. اجرای فایل اجرایی روی ویندوز واقعی انجام نشده (NOT RUN)؛ فقط بازبینی ایستای PE و اجرای
   همان کد به‌صورت بسته‌بندی‌شده روی لینوکس انجام شده است.
3. APK و installer ویندوز ارائه نشده (BLOCKED / NOT BUILT).

پیش‌شرط‌های پایلوت محدود: استفاده‌ی داخلی در یک مدرسه، با پشتیبان روزانه‌ی آزمون‌شده،
دسترسی از طریق شبکه‌ی محلی یا VPN، و پذیرش این نکته که داده‌ی دانش‌آموز روی یک رایانه
نگه‌داری می‌شود (نسخه‌ی ویندوزی).

## ۶. ثبت نهایی

| مورد | شناسه/نشانی |
|---|---|
| PR #1 (محصول کامل) | https://github.com/rezaa2544/p3/pull/1 — ادغام‌شده در `f59235b` |
| PR #2 (توزیع صادقانه دارایی‌ها) | https://github.com/rezaa2544/p3/pull/2 — ادغام‌شده در `f60a1af` |
| CI سبز (آخرین اجرا روی شاخه) | https://github.com/rezaa2544/p3/actions/runs/39993584837 |
| Release v0.1.0 | https://github.com/rezaa2544/p3/releases/tag/v0.1.0 |
| گزارش خام آزمون بار | `docs/testing/load-report-2026-10-23.json` |
| گزارش E2E جریان‌های محصول | `docs/testing/product-e2e.json` (۲۳/۲۳ PASS) |
| گزارش E2E نسخه‌ی تک‌فایل | `docs/testing/standalone-e2e.json` (۷/۷ PASS) |
| بازبینی ایستای EXE ویندوز | `artifacts/payesh2-win-static.json` (۷/۷ PASS، اجرا NOT RUN) |
| فراداده و هش دارایی‌ها | `artifacts/BUILD.md`, `artifacts/payesh2-*.json` |

هر ادعایی که در این سند PASS دارد، در تاریخ ۲۰۲۶-۱۰-۲۳ روی همین مخزن اجرا شده است؛ ادعاهای
BLOCKED/NOT RUN/NOT BUILT به همین صراحت در README و سند انتشار هم تکرار شده‌اند.
