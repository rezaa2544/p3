# دارایی‌های ساخت و دانلود مستقیم

نسخه: **۰.۱.۰** · تاریخ ساخت: ۲۰۲۶-۱۰-۲۳

## لینک‌های دانلود مستقیم (مخزن، مسیر raw)

| فایل | لینک | حجم |
|---|---|---|
| `payesh2-standalone-html.zip` (HTML + راهنما) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone-html.zip | ۱۱۴ KB |
| `payesh2-win-x64.zip` (EXE ویندوز x64 + راهنما) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-win-x64.zip | ۴۴ MB |
| `payesh2-standalone.html` (خام، بدون ZIP) | https://github.com/rezaa2544/p3/raw/main/artifacts/payesh2-standalone.html | ۳۸۲ KB |

## sha256 (بررسی سلامت دانلود)

```text
870e4597d31d9244b0f92983c7d3302f685d90d6ee029dbdff784fe26206f6b8  payesh2-standalone-html.zip
ff13e3902bb12da8658b233670efaa0588949c2245d88aff402bd99d2526f9c1  payesh2-win-x64.zip
7b2de672388d1e147bb65f1336ff61b523af8db5e6392b57cc924a9858bff1ec  payesh2-standalone.html
83449d361bffc7bac642d30fa81898a66d32d74c71f9e3d6554eab41b23aa880  payesh2.exe   (داخل ZIP ویندوز)
2fe5ac08acd48698acacc9eb7018556a38bc588880c3710ce3b910155585f431  payesh2       (لینوکس، ساخت محلی)
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
- بیلد ویندوز: `83449d36` — بیلد لینوکس: `03a0f614`
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
