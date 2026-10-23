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
9d54b9f113c1fc248121b8ae35fdaf78d2ebcc2c2ad3ca9d89e75c2b30bad0d7  payesh2-standalone-html.zip
4659dcd9cf311c15f7ba5356411b8db10afd933e975d7b04f1432e1e91e5a994  payesh2-win-x64.zip
d6a1be0c46a9dbb84a61501d41768757639fd2ded06be2d7d07c76a161f18c00  payesh2-standalone.html
61512ca69b07eea1c9c9d9cfa1067ebb9dbf7778a3a2a90f582befe57faae101  payesh2.exe   (داخل ZIP ویندوز)
aeb0582ab0728156701bd4a61db8942c319ba8f0f2662e7e1467bf908c765154  payesh2       (لینوکس، ساخت محلی)
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
- بیلد ویندوز: `c4d38d3fa7fb` — بیلد لینوکس: `34d18f0c66ad`
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
