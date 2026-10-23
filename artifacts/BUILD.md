# دارایی‌های ساخت و دانلود مستقیم

نسخه: **۰.۱.۰** · تاریخ ساخت: ۲۰۲۶-۱۰-۲۴

## لینک‌های دانلود مستقیم (مخزن، مسیر raw)

| فایل | لینک | حجم |
|---|---|---|
| `payesh2-win-x64.zip` (برنامهٔ میزکار ویندوز x64 + راهنمای نصب) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip | ۴۴ MB |
| `payesh2-standalone-html.zip` (HTML + راهنما) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip | ۱۱۵ KB |
| `payesh2-android.apk` (APK امضاشده) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-android.apk | ۱۴۱ KB |
| `payesh2-standalone.html` (خام، بدون ZIP) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone.html | ۳۸۵ KB |

## sha256 (بررسی سلامت دانلود)

```text
83e73f12b94492dae8d18c4341608a6c4239237b7c6bf063553457e4d135e487  payesh2-android.apk   (۱۴۴٬۶۸۶ بایت، امضای v2+v3)
667eaaf47e42d5514225383e40d8dc8eb2eb4ebc6bcf0ffd70a3174703c2625f  payesh2-win-x64.zip
fc205a4e19c03ab6937e18246b149f9e7386edaed1b0fe7d66e3b0281c5e78af  payesh2-standalone-html.zip
05b32fd11ce3cf083bf0dff0e0686f542fca2fbc8330d768d1275ae39fe32c8c  payesh2-standalone.html
7f16071babf9845d43d9f88885081633209c23238a3b6ebb275c757a9e98c7a9  Payesh2.exe   (داخل ZIP ویندوز، ۱۲۵٬۳۲۴٬۸۰۰ بایت)
0113b0a95863253eee0dddf3e06d4b24877d2a14b0a42aa2531a895935ad1b00  payesh2       (لینوکس، ساخت محلی)
```

بررسی در ویندوز (PowerShell):

```powershell
Get-FileHash .\payesh2-win-x64.zip -Algorithm SHA256
Expand-Archive .\payesh2-win-x64.zip -DestinationPath .\payesh2
Get-FileHash .\payesh2\Payesh2.exe -Algorithm SHA256
```

## فایل اجرایی ویندوز: چه چیزی داخلش است؟

- باینری رسمی **Node 26.12.1** (`node-win-x64`) به‌عنوان میزبان SEA.
- `server.cjs` (API کامل)، `desktop.cjs` (پوستهٔ نصب/اجرا/حذف)، مهاجرت‌ها، `web/`،
  فایل‌های `pglite.wasm`/`pglite.data` و HTML تک‌فایل.
- منابع PE: آیکون برنامه (`artifacts/payesh2.ico`) و اطلاعات نسخه/محصول
  («پایش ۲ — Payesh 2», v0.1.0) با `scripts/lib/pe.mjs` (پکیج `resedit`).
- زیرسیستم PE: **GUI (۲)** — اجرای فایل هیچ پنجرهٔ کنسولی باز نمی‌کند. تغییر فقط در
  سرآیند PE است (`e_lfanew + 24 + 68`) و به کد برنامه دست نمی‌زند.

بازبینی ایستای خودکار: `npm run verify:win` → `artifacts/payesh2-win-static.json`
(**۱۳/۱۳ PASS**: PE32+ x64، زیرسیستم GUI، آیکون، نسخه، وجود `desktop.cjs`/`server.cjs`/
`migrations`/`pglite.wasm`/HTML تک‌فایل).

## APK اندروید

APK در CI ساخته می‌شود (Android SDK در این سندباکس در دسترس نیست):

```bash
# در CI: کار «ساخت APK اندروید»
cd apps/android && gradle --no-daemon assembleRelease
zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks pilot.keystore --out artifacts/payesh2-android.apk aligned.apk
node scripts/verify-apk.mjs     # ۱۹/۱۹ PASS
```

- شناسه: `ir.payesh2.app` · نسخه `0.1.0` (code 1) · minSdk 24 · targetSdk 34
- امضا: APK Signature Scheme v2+v3 (کلید پایلوت RSA 3072، گواهی SHA-256 `99d68ace…4e49`)
- بازبینی ایستا: `artifacts/verify-apk.json` (۱۹/۱۹ PASS) · فراداده: `artifacts/payesh2-android.json`
- اجرا روی دستگاه: **NOT RUN**

## بازتولیدپذیری

ZIP‌ها با زمان فایل ثابت و `zip -X` ساخته می‌شوند؛ بنابراین دو بار ساخت پشت‌سرهم، بایت‌به‌بایت
یکسان است و sha256 منتشرشده با فایل دانلودی مطابقت دارد (آزموده شد).

## چرا ZIP؟

- `Payesh2.exe` خام ۱۲۵٬۳۲۴٬۸۰۰ بایت است و حد مجاز هر فایل در گیت‌هاب **۱۰۰MB** است؛ ZIP آن ۴۴MB می‌شود.
- باینری لینوکس (۱۷۰MB) نه در گیت است و نه در ZIP عرضه شده؛ برای راستی‌آزمایی محلی ساخته می‌شود.

## بازتولید همه‌ی دارایی‌ها

```bash
npm ci && npm run build
npm run artifact:html        # HTML تک‌فایل (اسکریپت کلاسیک + نگهبان بوت)
npm run artifact:exe         # EXE ویندوز: SEA + منابع PE + زیرسیستم GUI
npm run verify:win           # بازبینی ایستای PE (بدون ویندوز)
npm run artifact:exe:linux   # همان کد برای اجرای واقعی/آزمون
npm run release:assets       # کل زنجیره + ZIPها + checksums.json
npm run test:e2e:desktop     # آزمون میزکار با مرورگر واقعی (نیازمند اجرای --server)
```

## فراداده‌ی ساخت

- Node بسته‌بندی‌شده: **26.12.1** (باینری رسمی از `node-win-x64` / `node-linux-x64`)
- بیلد ویندوز: `c12653989023` — بیلد لینوکس: `8bab4f9dbc48`
- زیرسیستم ویندوز: GUI (`consoleWindow: false`)، آیکون جاسازی‌شده: بله
- اجرای واقعی بستهٔ لینوکسی (همان کد، همان پوسته): `--plan` نقشهٔ کامل نصب را چاپ کرد،
  `--server` مهاجرت‌ها را اعمال کرد، حساب `123456`/`123456` را ساخت، روی `127.0.0.1:3311`
  گوش داد و `POST /api/auth/login` با کد ۲۰۰ پاسخ داد (نشست `httpOnly` + `Secure`).
- آزمون مرورگر واقعی (Chromium): `docs/testing/standalone-e2e.json` → **۷/۷ PASS**؛
  آزمون میزکار `docs/testing/desktop-e2e.json` (اجرا در CI — به `docs/testing/06-desktop.md` نگاه کنید).

## وضعیت توزیع

| مسیر | وضعیت |
|---|---|
| دانلود مستقیم از مخزن (raw) | **PASS** |
| آپلود دارایی در GitHub Release | **BLOCKED** — میزبان `uploads.github.com` از محیط ساخت پاسخ نمی‌دهد |
| امضای دیجیتال EXE | **NOT BUILT** — گواهی تجاری در دسترس نیست؛ SmartScreen ممکن است هشدار بدهد |
| اجرای EXE روی ویندوز واقعی | **NOT RUN** — بازبینی ایستای PE و اجرای همان کد روی لینوکس انجام شده است |
