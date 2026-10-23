/**
 * نقطهٔ ورود نسخهٔ میزکار (ویندوز).
 *
 * این ماژول داخل فایل اجرایی بسته‌بندی می‌شود و مسئول چهار حالت است: نصب، اجرا، حذف و
 * «فقط سرور». هیچ‌کدام از تصمیم‌ها اینجا اختیاری نیست؛ همه از `shell-plan.ts` و
 * `install-plan.ts` می‌آیند تا آزمون‌پذیر بمانند. این فایل فقط «سیم‌کشی» است.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { layoutFromEnv, planInstall, type InstallLayout } from './install-plan.js';
import { defaultDeps, runInstall, runUninstall, showMessage, DesktopError, WINDOWS_ONLY_MESSAGE } from './installer.js';
import {
  DESKTOP_ADMIN_PASSWORD,
  DESKTOP_ADMIN_USERNAME,
  appUrl,
  buildBrowserArgs,
  desktopServerEnv,
  healthUrl,
  installSuccessMessage,
  isInstalledCopy,
  isPayeshHealth,
  parseDesktopArgs,
  pickBrowser,
  resolvePort,
  uninstallConfirmMessage,
} from './shell-plan.js';

export type DesktopContext = {
  /** process.argv بدون دو ورودی اول (نام فایل اجرایی و مسیر) */
  argv: string[];
  execPath: string;
  buildId: string;
  version: string;
  /** آیا با پنجرهٔ GUI اجرا شده (بدون کنسول)؟ */
  gui: boolean;
  env: NodeJS.ProcessEnv;
  /** استخراج دارایی‌های زمان اجرا؛ مسیر پوشهٔ runtime را برمی‌گرداند */
  ensureRuntime(): string;
  /** بارگذاری باندل سرور (بلافاصله listen می‌کند) */
  startServer(runtimeDir: string): void;
  log(line: string): void;
  exit(code: number): void;
};

function homeDir(ctx: DesktopContext): string {
  if (ctx.env.PAYESH2_HOME) return ctx.env.PAYESH2_HOME;
  const local = ctx.env.LOCALAPPDATA;
  return local ? path.join(local, 'Payesh2') : path.join(ctx.env.USERPROFILE ?? '', '.payesh2');
}

export function resolveLayout(ctx: DesktopContext): InstallLayout {
  return layoutFromEnv(ctx.env, ctx.env.USERPROFILE ?? ctx.env.HOME ?? '');
}

/** بررسی سلامت سرور محلی (بدون وابستگی به fetch، برای Node داخل SEA). */
export function checkHealth(url: string, timeoutMs = 1500): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          resolve(undefined);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(undefined);
    });
    req.on('error', () => resolve(undefined));
    req.end();
  });
}

async function waitForServer(url: string, attempts = 120): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const body = await checkHealth(url);
    if (isPayeshHealth(body)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** بازکردن پنجرهٔ برنامه؛ اگر مرورگر میزبان پیدا نشد، مرورگر پیش‌فرض. */
export function openWindow(input: {
  url: string;
  profileDir: string;
  env: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  onExit?: () => void;
}): { browser: string; tracked: boolean } {
  const exists = input.exists ?? existsSync;
  const found = pickBrowser(input.env, exists);
  if (found) {
    const child = spawn(found.path, buildBrowserArgs(input.url, input.profileDir), {
      detached: false,
      stdio: 'ignore',
    });
    child.on('exit', () => input.onExit?.());
    child.on('error', () => input.onExit?.());
    return { browser: found.name, tracked: true };
  }
  // ویندوز ۱۰/۱۱ همیشه Edge دارد؛ این مسیر فقط برای محیط‌های غیرمعمول است.
  const fallback = spawn('cmd.exe', ['/c', 'start', '', input.url], { stdio: 'ignore', windowsHide: true });
  fallback.unref();
  return { browser: 'default', tracked: false };
}

function startServerMode(ctx: DesktopContext, layout: InstallLayout): number {
  const home = homeDir(ctx);
  mkdirSync(path.join(home, 'data'), { recursive: true });
  mkdirSync(path.join(home, 'uploads'), { recursive: true });
  mkdirSync(layout.logDir, { recursive: true });
  const runtimeDir = ctx.ensureRuntime();
  const port = resolvePort(ctx.env);
  const injected = desktopServerEnv({
    home,
    port,
    buildId: ctx.buildId,
    adminUsername: ctx.env.ADMIN_USERNAME ?? DESKTOP_ADMIN_USERNAME,
    adminPassword: ctx.env.ADMIN_PASSWORD ?? DESKTOP_ADMIN_PASSWORD,
  });
  for (const [key, value] of Object.entries(injected)) {
    if (!ctx.env[key]) ctx.env[key] = value;
  }
  process.env.APP_VERSION = ctx.version;
  ctx.startServer(runtimeDir);
  return port;
}

/** اجرای حالت میزکار؛ خروجی کد فرایند. */
export async function runDesktop(ctx: DesktopContext): Promise<void> {
  const args = parseDesktopArgs(ctx.argv);
  const layout = resolveLayout(ctx);
  const deps = defaultDeps();
  const port = resolvePort(ctx.env);
  const url = appUrl(port);

  ctx.log(`mode=${args.mode} gui=${ctx.gui} build=${ctx.buildId} version=${ctx.version}`);

  try {
    if (args.mode === 'plan') {
      const steps = planInstall({
        layout,
        selfPath: ctx.execPath,
        selfBytes: 0,
        version: ctx.version,
      });
      ctx.log(JSON.stringify({ mode: 'plan', layout, steps }, null, 2));
      ctx.exit(0);
      return;
    }

    if (args.mode === 'uninstall') {
      if (!args.silent) {
        const answer = showMessage(deps, uninstallConfirmMessage(), 'yesno');
        if (answer !== 6) {
          ctx.log('uninstall cancelled');
          ctx.exit(0);
          return;
        }
      }
      const result = runUninstall({ layout, deps });
      ctx.log(`uninstalled shortcuts=${result.removedShortcuts}`);
      if (!args.silent) {
        showMessage(
          deps,
          'پایش ۲ حذف شد. داده‌های مدرسه در پوشهٔ Payesh2 باقی ماند.',
          'info',
        );
      }
      ctx.exit(0);
      return;
    }

    // اجرا از نسخهٔ نصب‌شده: اگر همین فایل «نسخهٔ نصب‌شده» نیست ولی نصب وجود دارد،
    // نسخهٔ نصب‌شده را اجرا می‌کنیم (کاربر ممکن است فایل دانلودی را دوباره باز کند).
    if (args.mode === 'app' && !args.reinstall && !isInstalledCopy(ctx.execPath, layout) && existsSync(layout.appExe)) {
      deps.spawnDetached(layout.appExe, []);
      ctx.exit(0);
      return;
    }

    if (args.mode === 'install' || (args.mode === 'app' && !existsSync(layout.appExe))) {
      const result = runInstall({ layout, selfPath: ctx.execPath, version: ctx.version, deps });
      ctx.log(`installed steps=${result.steps} copied=${result.copied}`);
      if (!args.silent) showMessage(deps, installSuccessMessage(ctx.version, url), 'info');
      // پس از نصب، نسخهٔ نصب‌شده را اجرا می‌کنیم تا مسیرها و آیکون درست باشند.
      if (result.copied) deps.spawnDetached(layout.appExe, []);
      ctx.exit(0);
      return;
    }

    // حالت اجرا/سرور
    const already = await checkHealth(healthUrl(port));
    if (isPayeshHealth(already)) {
      ctx.log('server already running — opening window');
      if (args.mode === 'app' && !ctx.gui) {
        // اجرای دستی از خط فرمان: فقط گزارش می‌دهیم
        ctx.exit(0);
        return;
      }
      if (args.mode === 'app') {
        openWindow({ url, profileDir: path.join(homeDir(ctx), 'profile'), env: ctx.env, onExit: () => ctx.exit(0) });
      }
      ctx.exit(0);
      return;
    }

    startServerMode(ctx, layout);
    if (args.mode === 'server') {
      ctx.log('server-only mode');
      return;
    }
    const ready = await waitForServer(healthUrl(port));
    if (!ready) {
      ctx.log('server did not become ready');
      if (!args.silent) {
        showMessage(deps, `راه‌اندازی سرور محلی ناموفق بود. گزارش: ${path.join(layout.logDir, 'app.log')}`, 'error');
      }
      ctx.exit(1);
      return;
    }
    const win = openWindow({
      url,
      profileDir: path.join(homeDir(ctx), 'profile'),
      env: ctx.env,
      onExit: () => ctx.exit(0),
    });
    ctx.log(`window opened via ${win.browser} (tracked=${win.tracked}) url=${url}`);
  } catch (e) {
    const message = e instanceof DesktopError ? e.message : (e as Error).message;
    ctx.log(`error: ${message}`);
    if (e instanceof DesktopError && e.code === 'WINDOWS_ONLY' && !ctx.gui) {
      ctx.exit(1);
      return;
    }
    try {
      showMessage(defaultDeps(), message === WINDOWS_ONLY_MESSAGE ? message : `خطای پایش ۲: ${message}`, 'error');
    } catch {
      // اگر حتی پیام هم نمایش داده نشود، کد خروج گویاست.
    }
    ctx.exit(1);
  }
}
