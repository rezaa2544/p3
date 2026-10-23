/**
 * «پوستهٔ میزکار» — منطق خالص حالت‌های اجرای فایل ویندوزی.
 *
 * فایل اجرایی یک برنامه است با چند حالت:
 *   • نصب (پیش‌فرض وقتی هنوز نصب نشده) — کپی خودش به `%LOCALAPPDATA%`، میان‌بر، رجیستری
 *   • اجرا — سرور محلی روی ۱۲۷.۰٫۰٫۱ و بازکردن پنجرهٔ برنامه (بدون نوار آدرس)
 *   • حذف (`--uninstall`)
 *   • فقط سرور (`--server`) برای عیب‌یابی و آزمون
 *   • چاپ نقشه (`--plan`) برای بازبینی بدون اجرا
 *
 * همهٔ تصمیم‌ها اینجا دادهٔ خالص‌اند تا روی لینوکس هم آزمون شوند؛ اجرا در `cli.ts`.
 */
import path from 'node:path';
import { APP_DISPLAY_NAME, type InstallLayout } from './install-plan.js';

export type DesktopMode = 'app' | 'install' | 'uninstall' | 'server' | 'plan';

export type ParsedArgs = {
  mode: DesktopMode;
  silent: boolean;
  reinstall: boolean;
};

/** گزینه‌های خط فرمان؛ ناشناخته‌ها نادیده گرفته می‌شوند (ویندوز آرگومان‌های اضافه می‌گذارد). */
export function parseDesktopArgs(argv: readonly string[]): ParsedArgs {
  const has = (flag: string) => argv.includes(flag);
  const silent = has('--silent') || has('-s');
  if (has('--plan') || has('--dry-run')) return { mode: 'plan', silent, reinstall: has('--reinstall') };
  if (has('--uninstall')) return { mode: 'uninstall', silent, reinstall: false };
  if (has('--install')) return { mode: 'install', silent, reinstall: has('--reinstall') };
  if (has('--server') || has('--headless')) return { mode: 'server', silent, reinstall: false };
  return { mode: 'app', silent, reinstall: has('--reinstall') };
}

export const DEFAULT_PORT = 3210;

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PORT ?? DEFAULT_PORT);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PORT;
}

/** سرویس سلامت سرور محلی — برای تشخیص «نسخهٔ از قبل در حال اجرا». */
export function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/health`;
}

export function appUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

/** پاسخ سلامت فقط وقتی «همان برنامه» است پذیرفته می‌شود. */
export function isPayeshHealth(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { service?: unknown }).service === 'payesh2-api' &&
    (body as { status?: unknown }).status === 'ok'
  );
}

export type BrowserCandidate = { name: string; path: string };

/**
 * مرورگرهای میزبان «پنجرهٔ برنامه». Edge روی هر ویندوز ۱۰/۱۱ نصب است؛ Chrome گزینهٔ دوم.
 * حالت `--app=` پنجره‌ای بدون نوار آدرس/تب می‌سازد، بنابراین ظاهر یک برنامهٔ دسکتاپ دارد.
 */
export function browserCandidates(env: NodeJS.ProcessEnv): BrowserCandidate[] {
  const pf = env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = env.LOCALAPPDATA ?? '';
  const list: BrowserCandidate[] = [
    { name: 'Microsoft Edge', path: path.win32.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Microsoft Edge', path: path.win32.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
    { name: 'Google Chrome', path: path.win32.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    { name: 'Google Chrome', path: path.win32.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
  ];
  if (local) {
    list.push(
      { name: 'Microsoft Edge', path: path.win32.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
      { name: 'Google Chrome', path: path.win32.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') },
    );
  }
  return list;
}

/** نخستین مرورگر موجود (با آزمون‌پذیری: تابع وجود فایل تزریق می‌شود). */
export function pickBrowser(
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): BrowserCandidate | undefined {
  return browserCandidates(env).find((c) => exists(c.path));
}

/** آرگومان‌های پنجرهٔ برنامه: پروفایل جدا، اندازهٔ ثابت، بدون نوار آدرس. */
export function buildBrowserArgs(url: string, profileDir: string): string[] {
  return [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--window-size=1280,860',
  ];
}

/**
 * محیط سرور محلی در حالت میزکار:
 *  • فقط روی ۱۲۷٫۰٫۰٫۱ گوش می‌دهد (نه شبکهٔ مدرسه) تا رمز اولیه قابل سوءاستفاده نباشد.
 *  • اعتبارنامهٔ نخستین اجرا از تنظیمات نصب می‌آید و کاربر در اولین ورود مجبور به تغییر آن است.
 *  • گزارش‌ها به فایل می‌روند چون برنامه پنجرهٔ کنسول ندارد.
 */
export function desktopServerEnv(input: {
  home: string;
  port: number;
  buildId: string;
  adminUsername: string;
  adminPassword: string;
}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(input.port),
    PAYESH2_HOME: input.home,
    PAYESH2_BUILD: input.buildId,
    UPLOAD_DIR: path.join(input.home, 'uploads'),
    PGLITE_DIR: path.join(input.home, 'data'),
    APP_ORIGIN: `http://127.0.0.1:${input.port}`,
    // حلقهٔ محلی: مرورگرها ۱۲۷٫۰٫۰٫۱ را «مبدأ امن» می‌دانند و کوکی Secure را می‌پذیرند.
    COOKIE_SECURE: '1',
    TRUST_PROXY: '0',
    SEED_DEMO: '0',
    LOG_LEVEL: 'warn',
    PAYESH_FIRST_ADMIN: '1',
    ADMIN_USERNAME: input.adminUsername,
    ADMIN_PASSWORD: input.adminPassword,
    // نخستین اجرا رمز کوتاه را می‌پذیرد (نصب محلی، اولین ورود تغییر اجباری) — ADR 0005
    PAYESH_ALLOW_SHORT_ADMIN_PASSWORD: '1',
    PAYESH_DESKTOP: '1',
  };
}

export const DESKTOP_ADMIN_USERNAME = '123456';
export const DESKTOP_ADMIN_PASSWORD = '123456';

/** آیا همین فایل، نسخهٔ نصب‌شده اجرا شده است؟ */
export function isInstalledCopy(execPath: string, layout: InstallLayout): boolean {
  return path.win32.normalize(execPath).toLowerCase() === path.win32.normalize(layout.appExe).toLowerCase();
}

/** متن پیام نصب/خطا برای MessageBox (فارسی، کوتاه). */
export function installSuccessMessage(version: string, url: string): string {
  return [
    `${APP_DISPLAY_NAME} نسخهٔ ${version} نصب شد.`,
    '',
    `نام کاربری: ${DESKTOP_ADMIN_USERNAME}`,
    `رمز عبور: ${DESKTOP_ADMIN_PASSWORD}`,
    '',
    'در نخستین ورود، سامانه تغییر رمز را اجباری می‌کند.',
    `اگر پنجرهٔ برنامه باز نشد، این نشانی را در مرورگر باز کنید: ${url}`,
  ].join('\r\n');
}

export function uninstallConfirmMessage(): string {
  return [
    `آیا ${APP_DISPLAY_NAME} حذف شود؟`,
    '',
    'داده‌های مدرسه (پایگاه‌داده و فایل‌ها) حذف نمی‌شوند و در',
    '%LOCALAPPDATA%\\Payesh2 باقی می‌مانند.',
  ].join('\r\n');
}
