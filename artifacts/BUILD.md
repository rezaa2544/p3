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
f90196db50686c7a535fb3ddfe13f0ad691c32d395bf0c9cf6c47984b7f24f1a  payesh2-win-x64.zip
05b32fd11ce3cf083bf0dff0e0686f542fca2fbc8330d768d1275ae39fe32c8c  payesh2-standalone.html
c15dc6bb33ca40606e5dc0c54f38e0ba8f1432febb8760ff8d94070bb9e39159  payesh2.exe   (داخل ZIP ویندوز)
e2fecf5637db320af2e4a55083bea0b71f59bea2ccb4004146b593b3caa10f39  payesh2       (لینوکس، ساخت محلی)
```

بررسی در ویندوز (PowerShell):

```powershell
Get-FileHash .\payesh2-win-x64.zip -Algorithm SHA256
```

## بازتولیدپذیری

ZIP‌ها با زمان فایل ثابت و `zip -X` ساخته می‌شوند؛ بنابراین دو بار ساخت پشت‌سرهم، بایت‌به‌بایت
یکسان است و sha256 منتشرشده با فایل دانلودی مطابقت دارد (آزموده شد).

## چرا ZIP؟

- EXE خام ۱۲۴٬۶۴۳٬۳۲۸ بایت است و حد مجاز هر فایل در گیت‌هاب **۱۰۰MB** است؛ ZIP آن ۴۴MB می‌شود.
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
- بیلد ویندوز: `c2bbb585a308` — بیلد لینوکس: `cd3c1290cf65`
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
