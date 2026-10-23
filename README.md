# پایش ۲ — سامانه مدیریت مدرسه

سامانه‌ی کامل و مستقل مدیریت مدرسه به زبان فارسی و راست‌به‌چپ: حضور و غیاب، نمره و کارنامه،
تکالیف، اطلاع‌رسانی، داشبورد و گزارش، با کنترل دسترسی نقش‌محور، کار آفلاین و پایگاه داده‌ی
واقعی PostgreSQL.

- وب اپلیکیشن + PWA (کار آفلاین) با React 19 + Vite
- API با Fastify 5 + TypeScript + SQL خام و RLS
- ۹ نقش سازمانی: مدیر مجموعه، مدیر مدرسه، معاون، مسئول فناوری، دبیر، مشاور، مالی،
  دانش‌آموز، والد
- آزمون‌ها: **۱۰۲ آزمون API**، **۳۳ آزمون رابط** و **۳۰ بررسی E2E در مرورگر واقعی**
  (۷ تک‌فایل + ۲۳ جریان محصول، شامل قطع واقعی شبکه) — همه روی **PostgreSQL 16.2** هم اجرا
  شدند: [`docs/testing/01-strategy.md`](docs/testing/01-strategy.md)
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
| **ویندوز x64 — برنامهٔ میزکار (ZIP)** | **[⬇ payesh2-win-x64.zip](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip)** | ۴۴ MB | ✅ نصب per-user + میان‌بر + بدون پنجرهٔ کنسول (زیرسیستم GUI، آیکون و نسخهٔ جاسازی‌شده، بازبینی ایستای PE ۱۴/۱۴)؛ اجرا روی ویندوز واقعی **(NOT RUN)** |
| **HTML تک‌فایل (ZIP)** | **[⬇ payesh2-standalone-html.zip](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip)** | ۱۱۵ KB | ✅ در مرورگر واقعی آزموده شد (راهنمای file:// + ورود از سرور) |
| HTML خام (بدون ZIP) | [payesh2-standalone.html](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone.html) | ۳۸۵ KB | ✅ اسکریپت کلاسیک + نگهبان بوت، صفر ارجاع بیرونی |
| اپلیکیشن اندروید (APK) | — | — | ⛔ **BLOCKED** — بدون Android SDK/JDK در محیط ساخت |
| آدرس HTTPS عمومی | — | — | ⛔ **BLOCKED** — میزبان/دامنه در اختیار نبود؛ آدرس ساختگی اعلام نمی‌کنیم |
| نصب‌کنندهٔ جداگانه (Setup/NSIS) | — | — | ⛔ **NOT BUILT** — همان EXE خودش نصب می‌کند (بدون UAC، بدون نصب‌کنندهٔ سوم) |
| نسخهٔ لینوکس x64 | [ساخت محلی](artifacts/BUILD.md) | ۱۶۲ MB | ✅ ساخته و کامل آزموده شد؛ به‌دلیل حجم در گیت نیست |

هش دقیق فایل‌ها (برای بررسی سلامت دانلود): [`artifacts/BUILD.md`](artifacts/BUILD.md)

```text
payesh2-win-x64.zip          667eaaf47e42d5514225383e40d8dc8eb2eb4ebc6bcf0ffd70a3174703c2625f
payesh2-standalone-html.zip  fc205a4e19c03ab6937e18246b149f9e7386edaed1b0fe7d66e3b0281c5e78af
payesh2-standalone.html      05b32fd11ce3cf083bf0dff0e0686f542fca2fbc8330d768d1275ae39fe32c8c
```

> چرا ZIP و نه EXE خام؟ حد مجاز هر فایل در گیت‌هاب ۱۰۰MB است و EXE خام ۱۱۹MB است؛ ZIP آن
> ۴۴MB می‌شود. آپلود در بخش Releases همچنان BLOCKED است (میزبان `uploads.github.com` از محیط
> ساخت در دسترس نیست)؛ به‌جای لینک ساختگی، فایل در مخزن و با لینک `raw` منتشر شده است.

### ۱) ویندوز: نصب و اجرا (بدون کنسول، بدون Node)

1. [`payesh2-win-x64.zip`](https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip)
   را دانلود و باز کنید و روی `Payesh2.exe` دابل‌کلیک کنید.
   ساخت محلی: `npm ci && npm run build && npm run artifact:exe`
2. برنامه خودش را برای همان کاربر نصب می‌کند — **بدون پنجرهٔ CMD و بدون UAC**:
   - برنامه: `%LOCALAPPDATA%\Programs\Payesh2\Payesh2.exe`
   - داده: `%LOCALAPPDATA%\Payesh2\data` · گزارش: `%LOCALAPPDATA%\Payesh2\logs\app.log`
   - میان‌بر «پایش ۲» در منوی شروع و دسکتاپ + ثبت در «افزودن یا حذف برنامه‌ها»
3. **ورود نخستین:** نام کاربری `123456` و رمز `123456`.
   سامانه بلافاصله تغییر رمز را اجباری می‌کند (حداقل ۱۰ نویسه، شامل حرف و رقم).
4. پنجرهٔ برنامه در Microsoft Edge به‌صورت «برنامه» (بدون نوار آدرس) باز می‌شود؛ سرور محلی
   فقط روی `127.0.0.1:3210` گوش می‌دهد. بستن پنجره = بسته‌شدن برنامه.
5. حذف: «افزودن یا حذف برنامه‌ها» ← پایش ۲ ← حذف. داده‌های مدرسه پاک نمی‌شوند.

راهنمای کامل (فارسی، داخل ZIP هم هست): [`docs/deployment/windows-desktop-howto.txt`](docs/deployment/windows-desktop-howto.txt)
· طراحی و دلیل تصمیم‌ها: [`ADR 0005`](docs/decisions/0005-desktop-install-and-bootstrap-credentials.md)

> هشدار امنیتی: نسخهٔ میزکار برای یک رایانه/یک مدرسه است، TLS ندارد و عمداً فقط روی حلقهٔ
> محلی گوش می‌دهد. برای دسترسی معلمان از بیرون مدرسه، نسخهٔ سروری با دامنه و HTTPS را
> استفاده کنید (پایین را ببینید). فایل اجرایی امضای تجاری ندارد؛ SmartScreen ممکن است هشدار
> «ناشر ناشناس» بدهد — هش sha256 را با `artifacts/BUILD.md` مقایسه کنید.

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

### ۴) HTML تک‌فایل — چگونه درست استفاده شود

ZIP را باز کنید و **همین فایل را از خود سرور پایش ۲ باز کنید**:

```text
http://localhost:3000/standalone.html      ← همین فایل، با دسترسی کامل به API
http://localhost:3000/                     ← نسخه‌ی کامل برنامه (PWA)
```

دلیل: ورود با کوکی نشست و توکن CSRF کار می‌کند و مبدأ صفحه باید همان سرور باشد. اگر فایل را
با دابل‌کلیک (`file://`) باز کنید، مرورگر مبدأ `null` می‌دهد و ارتباط با API را مسدود می‌کند؛
در این حالت برنامه به‌جای فرم ورودِ بی‌اثر، **صفحه‌ی راهنما** با توضیح و دکمه‌ی رفتن به سرور
نشان می‌دهد.

> فایل خودبسنده است (CSS، JS و آیکون داخل خودش؛ صفر ارجاع بیرونی) و اسکریپت آن به‌صورت
> **کلاسیک** جاسازی شده تا در همه‌ی مرورگرها اجرا شود. یک «نگهبان بوت» هم دارد: اگر برنامه
> تا ۶ ثانیه بالا نیاید، پیام فارسی با راهنمای رفع مشکل نمایش داده می‌شود (هرگز صفحه‌ی سفید).
> آزمون مرورگر واقعی این مسیرها: `npm run test:e2e:standalone` — نتیجه در
> `docs/testing/standalone-e2e.json` و اسکرین‌شات‌ها در `docs/testing/evidence/`.

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
| آزمون و بار | `docs/testing/01-strategy.md` + `docs/testing/load-report-real-pg-2026-10-23.json` |
| PostgreSQL واقعی و بازیابی | `docs/testing/04-real-postgres-restore.md` |
| عملیات | `docs/operations/01-runbook.md` |
| نقشه راه | `docs/roadmap/01-phases.md` |
| تصمیم‌ها (ADR) | `docs/decisions/0001-stack.md` … `0003-packaging.md` |
| انتشارها | `docs/releases/v0.1.0.md` |
| دروازه‌ی شواهد (داوری نهایی) | `docs/evidence-gate.md` |

## آزمون‌ها

```bash
npm run typecheck && npm run lint
npm run test:api              # ۱۰۲ تست API (PGlite واقعی)
npm run test:web              # ۳۳ تست رابط
npm run build

# آزمون با مرورگر واقعی (نیازمند سرور در حال اجرا و Chromium)
E2E_BASE=http://127.0.0.1:3000 npm run test:e2e:standalone   # ۷ بررسی
E2E_BASE=http://127.0.0.1:3000 npm run test:e2e:product      # ۲۳ بررسی
npm run verify:win                                           # بازبینی ایستای EXE ویندوز
```

نتیجه‌ی آخرین اجرای ثبت‌شده (Chromium headless ۱۳۱): **۷/۷** و **۲۳/۲۳ PASS**؛ جزئیات در
[`docs/testing/03-product-e2e.md`](docs/testing/03-product-e2e.md).
آزمون میزکار (`npm run test:e2e:desktop`) در کار CI «نسخه میزکار» اجرا می‌شود؛ جزئیات و
وضعیت فعلی: [`docs/testing/06-desktop.md`](docs/testing/06-desktop.md).

## محدودیت‌های نسخه ۰.۱.۰ (صادقانه)

1. **استقرار اینترنتی انجام نشده**؛ آدرس HTTPS عمومی وجود ندارد (BLOCKED).
2. **فایل اجرایی ویندوز روی ویندوز واقعی اجرا نشده** (NOT RUN)؛ همان بسته روی لینوکس اجرا شد.
3. **APK اندروید ساخته نشده** (BLOCKED — بدون Android SDK/JDK). نصب‌کنندهٔ جداگانه لازم
   نیست: همان `Payesh2.exe` خودش را per-user نصب می‌کند (میان‌بر، رجیستری، حذف با
   `--uninstall`). اما اجرای این نصب روی ویندوز واقعی هنوز **NOT RUN** است.
4. آزمون E2E مرورگری و قطع واقعی شبکه **انجام شده** (۲۳/۲۳ PASS)؛ آنچه باقی است: اجرا روی
   ویندوز واقعی، آزمون بار روی PostgreSQL مدیریت‌شده و بازیابی روی سرور جداگانه.
5. MFA فقط از طریق API فعال می‌شود؛ پیامک/ایمیل واقعی ندارد.
6. آزمون بار روی **PostgreSQL 16.2 واقعی** انجام شد (۰ خطا، ۰ پاسخ غیر۲xx) اما روی یک ماشین
   و بدون TLS؛ آزمون بار روی سرویس مدیریت‌شده انجام نشده است.

## ساخت دارایی‌ها (بازتولیدپذیر)

```bash
npm run build                 # وب + API
npm run artifact:html         # → artifacts/payesh2-standalone.html
npm run artifact:exe          # → artifacts/payesh2.exe (ویندوز؛ روی لینوکس هم ساخته می‌شود)
npm run verify:win            # بازبینی PE: زیرسیستم GUI، آیکون، نسخه، دارایی‌ها
npm run artifact:exe:linux    # همان کد برای اجرای واقعی/آزمون میزکار
npm run release:assets        # هر دو ZIP + checksums.json
```

برای راستی‌آزمایی محلی همان بسته: `node scripts/build-exe.mjs --target linux-x64` و سپس
`PAYESH2_HOME=/tmp/payesh2 PORT=3000 ./artifacts/payesh2`.

## مجوز

کد این مخزن برای استفاده‌ی مدرسه‌ای/غیرتجاری منتشر شده است؛ پیش از استفاده‌ی تجاری با
نگه‌دارنده هماهنگ کنید.
