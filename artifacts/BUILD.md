# دارایی‌های ساخت و دانلود مستقیم

نسخه: **۰.۱.۰** · تاریخ ساخت: ۲۰۲۶-۱۰-۲۳

## لینک‌های دانلود مستقیم (مخزن، مسیر raw)

| فایل | لینک | حجم |
|---|---|---|
| `payesh2-standalone-html.zip` (HTML + راهنما) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip | ۱۱۵ KB |
| `payesh2-win-x64.zip` (EXE ویندوز x64 + راهنما) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip | ۴۴ MB |
| `payesh2-standalone.html` (خام، بدون ZIP) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone.html | ۳۸۵ KB |

## sha256 (بررسی سلامت دانلود)

```text
fc205a4e19c03ab6937e18246b149f9e7386edaed1b0fe7d66e3b0281c5e78af  payesh2-standalone-html.zip
3b6bb4fee3f56641da00279f80d211ffe3c22399d652cbdaf4ca0ca87a785359  payesh2-win-x64.zip
05b32fd11ce3cf083bf0dff0e0686f542fca2fbc8330d768d1275ae39fe32c8c  payesh2-standalone.html
2f05b558efb0af20fb2013825e44a5f47478e3aaae05288bf88200ada7c455df  payesh2.exe   (داخل ZIP ویندوز)
2fc095500f7dfeb9532cc8d095642c0aab63f839d8ca850f307c94c60feb8d2e  payesh2       (لینوکس، ساخت محلی)
```

بررسی در ویندوز (PowerShell):

```powershell
Get-FileHash .\payesh2-win-x64.zip -Algorithm SHA256
```

## بازتولیدپذیری

ZIP‌ها با زمان فایل ثابت و `zip -X` ساخته می‌شوند؛ بنابراین دو بار ساخت پشت‌سرهم، بایت‌به‌بایت
یکسان است و sha256 منتشرشده با فایل دانلودی مطابقت دارد (آزموده شد).

## چرا ZIP؟

- EXE خام ۱۲۵٬۲۹۱٬۰۰۸ بایت است و حد مجاز هر فایل در گیت‌هاب **۱۰۰MB** است؛ ZIP آن ۴۴MB می‌شود.
- باینری لینوکس (۱۶۹MB) نه در گیت است و نه در ZIP عرضه شده؛ برای راستی‌آزمایی محلی ساخته می‌شود.

## بازتولید همه‌ی دارایی‌ها

```bash
npm ci && npm run build
npm run artifact:html        # HTML تک‌فایل (اسکریپت کلاسیک + نگهبان بوت)
npm run artifact:exe         # EXE ویندوز (نیازمند npm registry برای باینری Node)
npm run release:assets       # هر دو ZIP + checksums.json
npm run test:e2e:standalone  # آزمون مرورگر واقعی (نیازمند سرور در حال اجرا)
```

## فراداده‌ی ساخت

- Node بسته‌بندی‌شده: **26.12.1** (باینری رسمی از `node-win-x64` / `node-linux-x64`)
- بیلد ویندوز: `1360a344f293` — بیلد لینوکس: `e203064be84b`
- راستی‌آزمایی بیلد لینوکسی: مهاجرت ۰۰۱+۰۰۲ اعمال شد، `GET /api/health` →
  `{"status":"ok","db":"ok","migrations":2}`، `GET /standalone.html` → ۲۰۰ و ۳۹۱٬۷۲۷ بایت،
  ورود مدیر با رمز تصادفی ۲۰۰.
- آزمون مرورگر واقعی (Chromium): `docs/testing/standalone-e2e.json` → **۷/۷ PASS**،
  اسکرین‌شات‌ها در `docs/testing/evidence/`.
- EXE ویندوز همین بیلد `/standalone.html` را هم در خود دارد (باندل تک‌فایل به‌صورت SEA asset)
  و همان فایل با هش `7b2de67…` جداگانه در ZIP نسخه‌ی HTML عرضه شده است.

## وضعیت توزیع

| مسیر | وضعیت |
|---|---|
| دانلود مستقیم از مخزن (raw) | **PASS** |
| آپلود دارایی در GitHub Release | **BLOCKED** — میزبان `uploads.github.com` از محیط ساخت پاسخ نمی‌دهد |
| امضای دیجیتال EXE | **NOT BUILT** — گواهی تجاری در دسترس نیست؛ SmartScreen ممکن است هشدار بدهد |
| اجرای EXE روی ویندوز واقعی | **NOT RUN** |
