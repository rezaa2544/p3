# پایش ۲ — نسخهٔ اندروید

اپلیکیشن اندروید «پایش ۲» پوسته‌ای نازک (WebView) برای همان رابط وب سامانه است:

- رابط کاربری، فارسی/RTL، واکنش‌گرا و PWA همان چیزی است که در نسخهٔ وب آزموده شده است؛
  بنابراین ظاهر و رفتار در همهٔ دستگاه‌ها یکی می‌ماند و دو نسخهٔ موازی نگه‌داری نمی‌کنیم.
- نشانی سرور **هارد‌کد نمی‌شود**: در نخستین اجرا یک صفحهٔ فارسی می‌پرسد و در
  `SharedPreferences` ذخیره می‌کند (منوی «تغییر نشانی سرور» برای اصلاح).
- اگر سرور در دسترس نباشد، صفحهٔ آفلاین فارسی (`assets/offline.html`) نشان داده می‌شود؛
  داده‌های ثبت‌شده در دستگاه پاک نمی‌شوند.
- بارگذاری فایل (تکالیف/پیوست)، دانلود با `DownloadManager` و دکمهٔ بازگشت سیستم مدیریت می‌شود.

## ساختار

```
apps/android/
├── settings.gradle         # مخزن‌های google()/mavenCentral()
├── build.gradle            # AGP 8.5.2
├── gradle.properties
└── app/
    ├── build.gradle        # compileSdk 34، minSdk 24، targetSdk 34، بدون وابستگی خارجی
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/ir/payesh2/app/MainActivity.java
        ├── assets/offline.html
        └── res/{layout,values,menu,mipmap-*}
```

هیچ وابستگی خارجی (AndroidX/Kotlin) وجود ندارد؛ فقط چارچوب اندروید. این کار بسته را کوچک،
ساخت را سریع و سطح حمله را کمتر می‌کند.

## ساخت

نیازمندی‌ها: JDK 17، Android SDK (`platforms;android-34`، `build-tools;34.0.0`)، Gradle 8.9.

```bash
export ANDROID_HOME=/path/to/android-sdk
cd apps/android
gradle --no-daemon assembleRelease      # خروجی: app/build/outputs/apk/release/app-release-unsigned.apk
```

امضا و بستهٔ نهایی (همان کاری که CI می‌کند):

```bash
"$ANDROID_HOME/build-tools/34.0.0/zipalign" -f -p 4 app-release-unsigned.apk aligned.apk
"$ANDROID_HOME/build-tools/34.0.0/apksigner" sign --ks pilot.keystore --ks-pass "pass:…" \
  --out ../../artifacts/payesh2-android.apk aligned.apk
node ../../scripts/verify-apk.mjs         # بازبینی ایستا: بسته، شناسه، SDK، امضا
```

## چرا ساخت در CI؟

در محیط ساخت این پروژه (سندباکس بدون شبکه به `dl.google.com`/`maven.google.com`)
نصب Android SDK ممکن نیست. کار CI «ساخت APK اندروید» همان ساخت را با ابزار رسمی انجام
می‌دهد، امضا می‌کند، بازبینی ایستا می‌گیرد و `artifacts/payesh2-android.apk` را در مخزن
ثبت می‌کند. جزئیات و شواهد: [`docs/testing/07-android.md`](../../docs/testing/07-android.md).
