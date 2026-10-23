# دارایی‌های ساخت و دانلود مستقیم

نسخه: **۰.۱.۰** · تاریخ ساخت: ۲۰۲۶-۱۰-۲۳

## لینک‌های دانلود مستقیم (مخزن، مسیر raw)

| فایل | لینک | حجم |
|---|---|---|
| `payesh2-standalone-html.zip` (HTML + راهنما) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip | ۱۱۳ KB |
| `payesh2-win-x64.zip` (EXE ویندوز x64) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip | ۴۴ MB |
| `payesh2-standalone.html` (خام، بدون ZIP) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone.html | ۳۷۷ KB |

## sha256 (بررسی سلامت دانلود)

```text
461404467c429b9d39997baee0cc39d911c7a8fef3966af9cde795291180734e  payesh2-standalone-html.zip
baaf83f8fe27fae7a876c24bc09fdda9b78de5f7774902867330ca237a82dcac  payesh2-win-x64.zip
3672f2a36b76090030686e95cc6a795d8bfa13a9046fb36092080536097f3f79  payesh2-standalone.html
faeaf19e4034e3a3702e8057308d8bc75e8f1af93628ee898f6eee4d9661ff46  payesh2.exe   (داخل ZIP)
af59452db1770eb5312f79cb2c543591facc6a2d44f0800a26613b8cff0ea6fa  payesh2       (لینوکس، ساخت محلی)
```

بررسی در ویندوز (PowerShell):

```powershell
Get-FileHash .\payesh2-win-x64.zip -Algorithm SHA256
```

## چرا ZIP؟

- EXE خام ۱۲۴٬۲۴۷٬۰۴۰ بایت است و حد مجاز هر فایل در گیت‌هاب **۱۰۰MB** است؛ ZIP آن ۴۴MB می‌شود.
- باینری لینوکس (۱۶۹MB) نه در گیت است و نه در ZIP عرضه شده؛ برای راستی‌آزمایی محلی ساخته می‌شود.

## بازتولید همه‌ی دارایی‌ها

```bash
npm ci && npm run build
npm run artifact:html                      # HTML تک‌فایل
npm run artifact:exe                       # EXE ویندوز (نیازمند npm registry برای باینری Node)
node scripts/build-exe.mjs --target linux-x64 && ./artifacts/payesh2   # راستی‌آزمایی محلی
cd artifacts && zip -9 payesh2-win-x64.zip payesh2.exe
```

## فراداده‌ی ساخت

- Node بسته‌بندی‌شده: **26.12.1** (باینری رسمی از `node-win-x64` / `node-linux-x64`)
- بیلد ویندوز: `eafd4866bee3` — بیلد لینوکس: `3e1a7d20c2dc`
- راستی‌آزمایی بیلد لینوکسی در همین تاریخ: مهاجرت ۰۰۱+۰۰۲ اعمال شد، `GET /api/health` →
  `{"status":"ok","db":"ok","migrations":2}`، ورود مدیر با رمز تصادفی ۲۰۰.

## وضعیت توزیع

| مسیر | وضعیت |
|---|---|
| دانلود مستقیم از مخزن (raw) | **PASS** |
| آپلود دارایی در GitHub Release | **BLOCKED** — میزبان `uploads.github.com` از محیط ساخت پاسخ نمی‌دهد |
| امضای دیجیتال EXE | **NOT BUILT** — گواهی تجاری در دسترس نیست؛ SmartScreen ممکن است هشدار بدهد |
| اجرای EXE روی ویندوز واقعی | **NOT RUN** |
