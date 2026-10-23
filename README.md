# پایش ۲ — سامانه مدیریت مدرسه

سامانه‌ی کامل و مستقل مدیریت مدرسه به زبان فارسی و راست‌به‌چپ: حضور و غیاب، نمره و کارنامه،
تکالیف، اطلاع‌رسانی، داشبورد و گزارش، با کنترل دسترسی نقش‌محور، کار آفلاین و پایگاه داده‌ی
واقعی PostgreSQL.

- وب اپلیکیشن + PWA (کار آفلاین) با React 19 + Vite
- API با Fastify 5 + TypeScript + SQL خام و RLS
- ۹ نقش سازمانی: مدیر مجموعه، مدیر مدرسه، معاون، مسئول فناوری، دبیر، مشاور، مالی،
  دانش‌آموز، والد
- آزمون‌ها: **۸۷ آزمون API** و **۲۹ آزمون رابط** (همه سبز) — گزارش کامل در
  [`docs/testing/01-strategy.md`](docs/testing/01-strategy.md)
- داوری شواهد: **READY FOR LIMITED PILOT** — جزئیات و محدودیت‌ها در
  [`docs/evidence-gate.md`](docs/evidence-gate.md)

---

## دریافت و اجرای پایش ۲

> نسخه: **v0.1.0** (۲۰۲۶-۱۰-۲۳) · [صفحه‌ی انتشار](https://github.com/rezaa2544/p3/releases/tag/v0.1.0)
>
> لینک‌های زیر **مستقیم** هستند: با کلیک، دانلود همان لحظه شروع می‌شود
> (مسیر `raw` گیت‌هاب؛ برای باینری، ZIP استفاده شده تا حجم زیر حد مجاز مخزن بماند).

| قالب | لینک دانلود مستقیم | حجم | وضعیت |
|---|---|---|---|
| **HTML تک‌فایل (ZIP)** | **[⬇ payesh2-standalone-html.zip](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip)** | ۱۱۳ KB | ✅ ساخته و بازبینی شد (ZIP شامل HTML + راهنما) |
| **ویندوز x64 (EXE در ZIP)** | **[⬇ payesh2-win-x64.zip](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip)** | ۴۴ MB | ✅ ساخته شد؛ اجرا روی ویندوز واقعی هنوز آزموده نشده (NOT RUN) |
| HTML خام (بدون ZIP) | [payesh2-standalone.html](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone.html) | ۳۷۷ KB | ✅ صفر ارجاع بیرونی، رندر در jsdom تأیید شد |
| اپلیکیشن اندروید (APK) | — | — | ⛔ **BLOCKED** — بدون Android SDK/JDK در محیط ساخت |
| آدرس HTTPS عمومی | — | — | ⛔ **BLOCKED** — میزبان/دامنه در اختیار نبود؛ آدرس ساختگی اعلام نمی‌کنیم |
| نصب‌کننده‌ی ویندوز (Setup/NSIS) | — | — | ⛔ **NOT BUILT** — نسخه‌ی تک‌فایل جایگزین شد |
| نسخه‌ی لینوکس x64 | [ساخت محلی](artifacts/BUILD.md) | ۱۶۲ MB | ✅ ساخته و کامل آزموده شد؛ به‌دلیل حجم در گیت نیست |

هش دقیق فایل‌ها (برای بررسی سلامت دانلود): [`artifacts/BUILD.md`](artifacts/BUILD.md)

```text
payesh2-win-x64.zip          baaf83f8fe27fae7a876c24bc09fdda9b78de5f7774902867330ca237a82dcac
payesh2-standalone-html.zip  461404467c429b9d39997baee0cc39d911c7a8fef3966af9cde795291180734e
payesh2-standalone.html      3672f2a36b76090030686e95cc6a795d8bfa13a9046fb36092080536097f3f79
```

> چرا ZIP و نه EXE خام؟ حد مجاز هر فایل در گیت‌هاب ۱۰۰MB است و EXE خام ۱۱۹MB است؛ ZIP آن
> ۴۴MB می‌شود. آپلود در بخش Releases همچنان BLOCKED است (میزبان `uploads.github.com` از محیط
> ساخت در دسترس نیست)؛ به‌جای لینک ساختگی، فایل در مخزن و با لینک `raw` منتشر شده است.

### ۱) ویندوز: اجرای فوری

1. فایل [`payesh2-win-x64.zip`](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip)
   را دانلود و باز کنید و `payesh2.exe` را در یک پوشه‌ی دلخواه اجرا کنید
   (نصب لازم نیست؛ Node هم لازم نیست). ساخت محلی: `npm ci && npm run build && npm run artifact:exe`
2. پنجره‌ی کنسول آدرس `http://localhost:3000` و **رمز موقت مدیر** را یک‌بار چاپ می‌کند؛
   آن را یادداشت کنید.
3. مرورگر را باز کنید → `http://localhost:3000` → با نام کاربری `admin` و همان رمز وارد شوید.
4. در نخستین ورود، رمز باید تغییر کند. سپس مدرسه/کلاس/دانش‌آموز/دبیر بسازید.

داده‌ها در `%USERPROFILE%\.payesh2\` نگه‌داری می‌شوند. برای دسترسی دستگاه‌های دیگر شبکه‌ی
مدرسه، `HOST=0.0.0.0` (پیش‌فرض) و آدرس IP رایانه را در مرورگر باز کنید.

متغیرهای اختیاری: `PORT` (۳۰۰۰)، `PAYESH2_HOME`، `ADMIN_PASSWORD`، `FIRST_SCHOOL_NAME`.

> هشدار امنیتی: نسخه‌ی ویندوزی برای یک رایانه/یک مدرسه است و TLS ندارد. برای دسترسی از
> اینترنت، نسخه‌ی سروری با دامنه و HTTPS را استفاده کنید (پایین را ببینید).
> فایل اجرایی امضای دیجیتال تجاری ندارد و ممکن است SmartScreen هشدار بدهد.

### ۲) اجرای سروری (توصیه‌شده برای تولید)

```bash
git clone https://github.com/rezaa2544/p3.git && cd p3
npm ci
npm run build

export NODE_ENV=production
export DATABASE_URL='postgres://user:pass@db-host:5432/payesh2?sslmode=require'
export SESSION_SECRET="$(openssl rand -base64 48)"
export COOKIE_SECURE=1
export APP_ORIGIN='https://payesh.example.ir'   # دامنه‌ی خودتان

node apps/api/dist/scripts/migrate.js
PAYESH_FIRST_ADMIN=1 node apps/api/dist/server.js
```

راهنمای کامل (پروکسی، TLS، پشتیبان، رخدادها): [`docs/deployment/01-runbook.md`](docs/deployment/01-runbook.md)

### ۳) اجرای محلی برای توسعه

```bash
npm ci
npm run db:migrate
SEED_DEMO=1 npm run db:seed     # داده‌ی نمونه‌ی ساختگی (هرگز در تولید)
npm run dev                      # API: 3000 ، وب: 5173
```

ورود نمونه‌ی توسعه: `admin` / `Payesh1404a` (فقط داده‌ی دمو).

### ۴) HTML تک‌فایل

[`payesh2-standalone-html.zip`](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip)
را دانلود و باز کنید. `payesh2-standalone.html` یک فایل خودبسنده است (بدون هیچ فایل جانبی) اما برای کار کردن به
API پایش ۲ در **همان مبدأ** نیاز دارد؛ بنابراین آن را از خود سرور پایش ۲ باز کنید یا آن را
روی میزبانی قرار دهید که `/api` را به سرور پایش ۲ پروکسی می‌کند. باز کردن مستقیم با
`file://` فقط صفحه‌ی ورود را نشان می‌دهد (بدون API).

---

## کارکردها

| حوزه | چه چیزی هست |
|---|---|
| حضور و غیاب | ثبت گروهی یک زنگ (حاضر/غایب/تأخیر/مرخصی)، اصلاح با دلیل و تاریخچه، گزارش روزانه و کلاسی |
| نمره | ارزیابی، ثبت نمره‌ی پیش‌نویس، تأیید معاون/مدیر، اصلاح فقط با دلیل، کارنامه‌ی چاپی A4 با میانگین وزنی |
| تکلیف | ساخت تکلیف، ارسال دانش‌آموز، پیوست فایل |
| ارتباط | اطلاعیه‌ی مدرسه/کلاس، خوانده‌شدن، اعلان درون‌سامانه‌ای، صف پردازش |
| داشبورد و گزارش | وضعیت امروز، حضور، نمرات در انتظار تأیید، گزارش‌های قابل چاپ |
| مدیریت | کاربران، نقش‌ها، دانش‌آموزان، والدین، کلاس‌ها، دروس، تخصیص دبیر، سال تحصیلی و ترم |
| حسابرسی | `audit_log` برای عملیات حساس (نمره، حضور، کاربر، ورود) |
| آفلاین | صف IndexedDB + ارسال خودکار با `Idempotency-Key`؛ موفقیت فقط با تأیید سرور |

## امنیت (خلاصه)

scrypt برای رمز، کوکی نشست `HttpOnly`/`SameSite`، CSRF اجباری، RLS با `set_config` در هر
تراکنش، محدودیت نرخ ورود، MFA TOTP (فعال‌سازی از API)، آپلود با لیست سفید و محدودیت حجم،
هدرهای امنیتی سخت‌گیرانه، پشتیبان با checksum. مدل تهدید و شکاف‌های شناخته‌شده:
[`docs/security/01-threat-model.md`](docs/security/01-threat-model.md)

## مستندات

| سند | مسیر |
|---|---|
| نیازمندی‌ها و دامنه | `docs/requirements/01-scope.md` |
| معماری | `docs/architecture/01-system.md` |
| امنیت و دسترسی | `docs/security/01-threat-model.md` ، `docs/security/access-control.md` |
| پایگاه داده | `docs/database/01-schema.md` |
| همگام‌سازی آفلاین | `docs/offline-sync/01-design.md` |
| استقرار | `docs/deployment/01-runbook.md` |
| آزمون و بار | `docs/testing/01-strategy.md` + `docs/testing/load-report-2026-10-23.json` |
| عملیات | `docs/operations/01-runbook.md` |
| نقشه راه | `docs/roadmap/01-phases.md` |
| تصمیم‌ها (ADR) | `docs/decisions/0001-stack.md` … `0003-packaging.md` |
| انتشارها | `docs/releases/v0.1.0.md` |
| دروازه‌ی شواهد (داوری نهایی) | `docs/evidence-gate.md` |

## آزمون‌ها

```bash
npm run typecheck && npm run lint
npm run test:api     # ۸۷ تست
npm run test:web     # ۲۹ تست
npm run build
```

## محدودیت‌های نسخه ۰.۱.۰ (صادقانه)

1. **استقرار اینترنتی انجام نشده**؛ آدرس HTTPS عمومی وجود ندارد (BLOCKED).
2. **فایل اجرایی ویندوز روی ویندوز واقعی اجرا نشده** (NOT RUN)؛ همان بسته روی لینوکس اجرا شد.
3. **APK اندروید ساخته نشده** (BLOCKED).
4. آزمون E2E مرورگری و قطع واقعی شبکه انجام نشده (NOT RUN).
5. MFA فقط از طریق API فعال می‌شود؛ پیامک/ایمیل واقعی ندارد.
6. آزمون بار روی PGlite (نه PostgreSQL مدیریت‌شده) و به‌صورت مشورتی است.

## ساخت دارایی‌ها (بازتولیدپذیر)

```bash
npm run build                 # وب + API
npm run artifact:html         # → artifacts/payesh2-standalone.html
npm run artifact:exe          # → artifacts/payesh2.exe (ویندوز؛ روی لینوکس هم ساخته می‌شود)
```

برای راستی‌آزمایی محلی همان بسته: `node scripts/build-exe.mjs --target linux-x64` و سپس
`PAYESH2_HOME=/tmp/payesh2 PORT=3000 ./artifacts/payesh2`.

## مجوز

کد این مخزن برای استفاده‌ی مدرسه‌ای/غیرتجاری منتشر شده است؛ پیش از استفاده‌ی تجاری با
نگه‌دارنده هماهنگ کنید.
