# آزمون نسخهٔ اندروید (APK)

هدف: ساختن یک APK واقعی، امضاشده و قابل نصب، و گفتن صریح اینکه چه چیزی اثبات شده و چه
چیزی نه. این سند ادعای «روی گوشی آزموده شد» ندارد.

## ۱) زنجیرهٔ ساخت (CI)

کار «ساخت APK اندروید» در `.github/workflows/ci.yml`:

| گام | ابزار | نتیجه |
|---|---|---|
| JDK | `actions/setup-java` → Temurin **17** | PASS |
| Gradle | `gradle/actions/setup-gradle` → **8.9** | PASS |
| Android SDK | `sdkmanager` → `platforms;android-34`، `build-tools;34.0.0` | PASS |
| ساخت | `gradle --no-daemon assembleRelease` (AGP 8.5.2) | PASS |
| ترازبندی | `zipalign -f -p 4` | PASS |
| امضا | `apksigner sign` (RSA 3072، طرح‌های v2+v3) | PASS |
| بازبینی امضا | `apksigner verify --print-certs --verbose` → `Verifies` | PASS |
| بازبینی بسته | `aapt2 dump badging` + `scripts/verify-apk.mjs` | **PASS ۱۹/۱۹** |
| ثبت دارایی | کامیت `artifacts/payesh2-android.apk` + فراداده در همان شاخه | PASS |

اجرای مرجع: <https://github.com/rezaa2544/p3/actions/runs/40035040606>

## ۲) خروجی واقعی (از فایلِ ثبت‌شده در مخزن)

| ویژگی | مقدار |
|---|---|
| فایل | `artifacts/payesh2-android.apk` |
| حجم | **۱۴۴٬۶۸۶ بایت** (≈۱۴۱ KB) |
| sha256 | `83e73f12b94492dae8d18c4341608a6c4239237b7c6bf063553457e4d135e487` |
| شناسهٔ بسته | `ir.payesh2.app` |
| نسخه | `0.1.0` (versionCode 1) |
| minSdk / targetSdk | **24 / 34** (اندروید ۷ تا ۱۴) |
| اکتیویتی راه‌انداز | `ir.payesh2.app.MainActivity` |
| برچسب برنامه | «پایش ۲» |
| مجوزها | `INTERNET`، `ACCESS_NETWORK_STATE`، `WRITE_EXTERNAL_STORAGE` (فقط تا API 28، برای دانلود) |
| امضا | v2 = true، v3 = true، v1 = false؛ گواهی: `CN=Payesh 2 Pilot, OU=School, O=Payesh 2, C=IR`، SHA-256 گواهی `99d68ace…4e49` |
| کلاس‌های کد | `classes.dex` = ۱۲٬۷۹۲ بایت شامل `Lir/payesh2/app/MainActivity;` و کلاس‌های لامبدای آن |

بازبینی‌های ایستا (۱۹ مورد، `scripts/verify-apk.mjs`): سالم بودن ZIP، وجود
`AndroidManifest.xml`/`resources.arsc`/`classes.dex` (با کد واقعی، نه خالی)، وجود آیکون
(مسیر اعلام‌شده در مانیفست داخل بسته)، شناسه/نسخه، `minSdk`/`targetSdk` (از badging و
xmltree)، اکتیویتی راه‌انداز، برچسب فارسی، مجوز اینترنت، `Verifies` از `apksigner` و فعال
بودن v2/v3، و `debuggable=false`.

## ۳) بررسی‌های تکمیلی انجام‌شده روی همان فایل

- استخراج `classes.dex` و جست‌وجوی رشته‌ها: `Lir/payesh2/app/MainActivity;`،
  `Landroid/webkit/WebView;`، `loadUrl`، `setJavaScriptEnabled`، `onBackPressed`،
  `normalizeServerUrl` و `file:///android_asset/offline.html` **هر هفت مورد موجودند** — یعنی
  کد برنامه (نه یک قالب خالی) داخل APK است.
- `aapt2 dump xmltree` روی مانیفست باینری: `uses-sdk` (24/34)، سه `uses-permission`،
  `supportsRtl=true`، `usesCleartextTraffic=true`، `MainActivity` با `exported=true` و
  `configChanges` — همان چیزی که در سورس است.
- `assets/offline.html` (۱٬۷۲۵ بایت) داخل بسته هست.

## ۴) چه چیزی انجام نشده (صادقانه)

| مورد | وضعیت | چرا |
|---|---|---|
| نصب و اجرای APK روی گوشی/تبلت واقعی | **NOT RUN** | در محیط ساخت دستگاه اندرویدی و `adb` وجود ندارد |
| اجرا روی شبیه‌ساز (AVD) | **NOT RUN** | شبیه‌ساز به KVM/زیرساخت مجازی‌سازی نیاز دارد و در این محیط نیست |
| آزمون خودکار UI اندروید (Espresso/UIAutomator) | **NOT BUILT** | نیازمند دستگاه/شبیه‌ساز؛ برای پایلوت، آزمون همان رابط وب (۲۳/۲۳ E2E) تکیه‌گاه است |
| امضای ثابت برای به‌روزرسانی درجا | **NOT DONE** | کلید پایلوت در هر اجرا ساخته می‌شود؛ برای نصب نسخهٔ جدید باید نسخهٔ قبلی حذف شود (ADR 0006) |
| انتشار در Google Play | **BLOCKED** | نیاز به حساب توسعه‌دهنده و بازبینی؛ برای پایلوت مدرسه لازم نیست |

## ۵) اجرای دستی آزمون‌ها

```bash
npm run verify:apk              # بازبینی ایستای artifacts/payesh2-android.apk
APK_PATH=/path/to/app.apk AAPT2_PATH=/path/to/aapt2 node scripts/verify-apk.mjs
```

در CI همان اسکریپت بعد از امضا اجرا می‌شود و گزارش (`artifacts/verify-apk.json`) و خلاصهٔ
نتایج به‌صورت annotation منتشر می‌شود.
