import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.js';
import { StandaloneGuide } from './pages/StandaloneGuide.js';
import { Toaster } from './components/ui.js';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('ریشه برنامه یافت نشد');

/**
 * فایل «HTML تک‌فایل» اگر با file:// باز شود به API دسترسی ندارد (مبدأ null).
 * در آن حالت به‌جای فرم ورودِ بی‌اثر، راهنمای روشن نشان می‌دهیم.
 */
const openedAsFile = typeof window !== 'undefined' && window.location.protocol === 'file:';

createRoot(root).render(
  <StrictMode>
    {openedAsFile ? <StandaloneGuide /> : <App />}
    <Toaster />
  </StrictMode>,
);

// سرویس‌ورکر فقط در نسخه ساخته‌شده فعال است؛ در حالت توسعه ثبت نمی‌شود.
if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      /* به‌روزرسانی در چرخه بعدی بارگذاری اعمال می‌شود */
    },
  });
}
