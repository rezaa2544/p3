# دارایی‌های ساخت (Artifacts)

| فایل | وضعیت |
|---|---|
| `payesh2-standalone.html` | در مخزن نگه‌داری می‌شود (۳۷۷KB، بدون هیچ ارجاع بیرونی) |
| `payesh2-win-x64.json` / `payesh2-linux-x64.json` | فراداده‌ی ساخت: نسخه Node، حجم، sha256 |
| `payesh2.exe` (ویندوز x64، ~۱۱۹MB) | **ساخته شد ولی در GitHub Release آپلود نشد** — میزبان آپلود دارایی‌های
  GitHub (`uploads.github.com`) از این محیط در دسترس نیست (BLOCKED). فایل روی سندباکس در
  `artifacts/payesh2.exe` موجود است و با دستور زیر بازتولید می‌شود |
| `payesh2` (لینوکس x64، ~۱۶۲MB) | همان وضعیت باینری ویندوز؛ برای راستی‌آزمایی استفاده شد |

## بازتولید

```bash
npm ci && npm run build
npm run artifact:html              # → artifacts/payesh2-standalone.html
npm run artifact:exe               # → artifacts/payesh2.exe (نیازمند دسترسی به npm registry)
node scripts/build-exe.mjs --target linux-x64
```

## هش‌های نسخه ۰.۱.۰

| فایل | بایت | sha256 |
|---|---|---|
| `payesh2.exe` | 124,247,040 | `ad78f034d6d0eb0547849072473d08396a7160d36b8f1927a634ddc727cbb1eb` |
| `payesh2` (linux) | 169,151,680 | `3047a6d4ce986c1e9eb18f7b49475429e7f89bdebeed4b487b43e7177b2557aa` |
| `payesh2-standalone.html` | 385,472 | `3672f2a36b76090030686e95cc6a795d8bfa13a9046fb36092080536097f3f79` |

> باینری‌ها عمداً در گیت نگه‌داری نمی‌شوند (حجم و قواعد مخزن). برای توزیع، همین دستورهای
> بازتولید یا آپلود دستی در Release استفاده شود.
