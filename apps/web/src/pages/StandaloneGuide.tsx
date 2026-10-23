import { useState } from 'react';
import { Alert, Button, Card, Field, Input } from '../components/ui.js';

/**
 * صفحه‌ی راهنما برای وقتی که فایل «HTML تک‌فایل» با پروتکل file:// باز شده است.
 *
 * دلیل وجود این صفحه (تجربه‌ی واقعی کاربر): با file:// مبدأ صفحه null است، کوکی نشست
 * ارسال نمی‌شود و درخواست‌های /api اصلاً امکان اجرا ندارند؛ نتیجه‌ی نسخه‌ی قبل یک صفحه‌ی
 * ورودِ بی‌فایده (یا در بعضی مرورگرها صفحه‌ی سفید) بود. اینجا به‌جای آن، وضعیت را دقیق
 * توضیح می‌دهیم و مسیر درست را می‌دهیم. هیچ ادعای موفقیتی هم نمی‌کنیم.
 */
export function StandaloneGuide() {
  const [server, setServer] = useState('http://localhost:3000');
  const clean = server.trim().replace(/\/+$/, '');
  const target = /^https?:\/\//i.test(clean) ? clean : `http://${clean}`;

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="login-brand">
          <div>
            <div className="t">پایش ۲</div>
            <div className="s">نسخه‌ی HTML تک‌فایل</div>
          </div>
        </div>

        <Alert tone="warning">
          این فایل با آدرس <code dir="ltr">file://</code> باز شده است. در این حالت مرورگر اجازه‌ی
          ارتباط با سرور پایش ۲ را نمی‌دهد (مبدأ <code dir="ltr">null</code>، بدون کوکی نشست)؛
          بنابراین ورود و هیچ داده‌ای کار نمی‌کند.
        </Alert>

        <div className="mt-3" />
        <h2>راه درست</h2>
        <ol style={{ paddingInlineStart: '1.25rem', lineHeight: 2 }}>
          <li>
            سرور پایش ۲ را اجرا کنید: در ویندوز <code dir="ltr">payesh2.exe</code>، در سرور{' '}
            <code dir="ltr">node apps/api/dist/server.js</code>
          </li>
          <li>
            همین فایل را از خود سرور باز کنید: <code dir="ltr">http://localhost:3000/standalone.html</code>{' '}
            (یا نسخه‌ی کامل برنامه در <code dir="ltr">http://localhost:3000/</code>)
          </li>
          <li>با نام کاربری و رمزی که مدیر برای شما ساخته وارد شوید.</li>
        </ol>

        <div className="mt-3" />
        <Field label="نشانی سرور" htmlFor="server" hint="اگر سرور روی رایانه/شبکه‌ی دیگری است، نشانی آن را وارد کنید">
          <Input
            id="server"
            dir="ltr"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </Field>
        <div className="row mt-3">
          <Button variant="primary" type="button" onClick={() => window.location.assign(`${target}/`)}>
            رفتن به برنامه روی سرور
          </Button>
          <Button
            type="button"
            onClick={() => window.location.assign(`${target}/standalone.html`)}
            title="باز کردن همین فایل از روی سرور (با دسترسی به API)"
          >
            باز کردن این فایل از سرور
          </Button>
        </div>

        <p className="muted mt-3" style={{ fontSize: '.85rem', lineHeight: 1.9 }}>
          برای اجرای سرور در ویندوز، فایل <code dir="ltr">payesh2.exe</code> را از بسته‌ی
          دانلودی اجرا کنید؛ رمز موقت مدیر یک‌بار در پنجره‌ی کنسول چاپ می‌شود.
        </p>
      </Card>
    </div>
  );
}
