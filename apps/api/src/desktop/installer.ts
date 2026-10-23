/**
 * اجراکنندهٔ نصب/حذف ویندوز.
 *
 * این ماژول همان «نقشهٔ نصب» (`install-plan.ts`) را روی دیسک و رجیستری پیاده می‌کند.
 * هیچ فرمانی از ورودی کاربر ساخته نمی‌شود؛ همهٔ مسیرها از نقشه می‌آیند و با نقل‌قول
 * تک‌نویسه‌ای PowerShell امن شده‌اند.
 *
 * برای آزمون‌پذیری، همهٔ کنش‌های سیستمی از طریق `InstallerDeps` تزریق می‌شوند؛ اجرای
 * واقعی فقط روی ویندوز مجاز است (وگرنه خطای فارسی با کد `WINDOWS_ONLY`).
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import {
  buildMessageBoxScript,
  buildRegistryCommands,
  buildRemovalScript,
  buildShortcutScript,
  buildUninstallSteps,
  type InstallLayout,
  type InstallStep,
  planInstall,
} from './install-plan.js';

export type InstallerDeps = {
  platform: NodeJS.Platform;
  exists(p: string): boolean;
  mkdirp(p: string): void;
  copy(from: string, to: string): void;
  remove(p: string): void;
  removeDir(p: string): void;
  sizeOf(p: string): number;
  /** اجرای یک فرمان و برگرداندن کد خروج (خطا پرتاب نمی‌کند) */
  exec(cmd: string, args: string[]): number;
  /** اجرای فرمان بی‌انتظار (برای بازکردن برنامه پس از نصب) */
  spawnDetached(cmd: string, args: string[]): void;
};

export class DesktopError extends Error {
  constructor(
    readonly code: 'WINDOWS_ONLY' | 'COPY_FAILED' | 'REGISTRY_FAILED' | 'SHORTCUT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}

export const WINDOWS_ONLY_MESSAGE = 'نصب و حذف نسخهٔ میزکار فقط روی ویندوز پشتیبانی می‌شود.';

export function defaultDeps(): InstallerDeps {
  return {
    platform: process.platform,
    exists: existsSync,
    mkdirp: (p) => mkdirSync(p, { recursive: true }),
    copy: (from, to) => copyFileSync(from, to),
    remove: (p) => rmSync(p, { force: true }),
    removeDir: (p) => rmSync(p, { recursive: true, force: true }),
    sizeOf: (p) => statSync(p).size,
    exec: (cmd, args) => {
      try {
        execFileSync(cmd, args, { stdio: 'ignore' });
        return 0;
      } catch (e) {
        return typeof (e as { status?: number }).status === 'number' ? (e as { status: number }).status : 1;
      }
    },
    spawnDetached: (cmd, args) => {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.unref();
    },
  };
}

/** PowerShell با سیاست اجرای موقت؛ برای اسکریپت‌های میان‌بر/پیام/حذف. */
export function powershellArgs(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script];
}

export function assertWindows(deps: InstallerDeps, allowOverride = process.env.PAYESH_ALLOW_NON_WINDOWS === '1'): void {
  if (deps.platform !== 'win32' && !allowOverride) {
    throw new DesktopError('WINDOWS_ONLY', WINDOWS_ONLY_MESSAGE);
  }
}

export type InstallResult = { steps: number; copied: boolean; failed?: { step: InstallStep; code: number } };

/**
 * اجرای نقشهٔ نصب. اگر کپی فایل اجرایی شکست بخورد، نصب نیمه‌کاره رها نمی‌شود: پوشه پاک می‌شود.
 */
export function runInstall(input: {
  layout: InstallLayout;
  selfPath: string;
  version: string;
  deps?: InstallerDeps;
}): InstallResult {
  const deps = input.deps ?? defaultDeps();
  assertWindows(deps);
  const steps = planInstall({
    layout: input.layout,
    selfPath: input.selfPath,
    selfBytes: deps.exists(input.selfPath) ? deps.sizeOf(input.selfPath) : 0,
    version: input.version,
  });

  const shortcuts = steps.flatMap((s) => (s.kind === 'shortcut' ? [s.spec] : []));
  let copied = false;
  for (const step of steps) {
    switch (step.kind) {
      case 'mkdir':
        deps.mkdirp(step.path);
        break;
      case 'copy':
        try {
          deps.copy(step.from, step.to);
          copied = true;
        } catch (e) {
          deps.removeDir(input.layout.installDir);
          throw new DesktopError('COPY_FAILED', `کپی فایل برنامه ناموفق بود: ${(e as Error).message}`);
        }
        break;
      case 'shortcut':
        break;
      case 'registry': {
        const code = deps.exec('reg.exe', step.args);
        if (code !== 0) throw new DesktopError('REGISTRY_FAILED', `ثبت در رجیستری ناموفق بود (کد ${code})`);
        break;
      }
      case 'run':
        deps.spawnDetached(step.exe, step.args);
        break;
    }
  }
  if (shortcuts.length) {
    const code = deps.exec('powershell.exe', powershellArgs(buildShortcutScript(shortcuts)));
    if (code !== 0) {
      // میان‌بر «خوب است»، اما نبودش نصب را ناموفق نمی‌کند؛ فقط گزارش می‌شود.
      return { steps: steps.length, copied, failed: { step: { kind: 'shortcut', spec: shortcuts[0]! }, code } };
    }
  }
  return { steps: steps.length, copied };
}

/** حذف: میان‌برها و رجیستری فوراً، فایل‌ها با یک فرایند جدا پس از بسته‌شدن برنامه. */
export function runUninstall(input: {
  layout: InstallLayout;
  deps?: InstallerDeps;
  removeData?: boolean;
}): { removedShortcuts: number; registryCode: number } {
  const deps = input.deps ?? defaultDeps();
  assertWindows(deps);
  const steps = buildUninstallSteps(input.layout);
  let removed = 0;
  for (const file of steps.removeFiles) {
    if (deps.exists(file)) {
      deps.remove(file);
      removed += 1;
    }
  }
  let registryCode = 0;
  for (const args of steps.registryCommands) {
    registryCode = deps.exec('reg.exe', args);
    if (registryCode !== 0) {
      // کلید نباید وجود داشته باشد؛ خطای «یافت نشد» طبیعی است.
      registryCode = 0;
    }
  }
  deps.exec(
    'powershell.exe',
    powershellArgs(buildRemovalScript(input.layout, { removeData: input.removeData ?? false })),
  );
  return { removedShortcuts: removed, registryCode };
}

/** نمایش پیام ویندوزی (نصب موفق/خطا)؛ در حالت `yesno` کد ۶ یعنی «بله». */
export function showMessage(
  deps: InstallerDeps,
  message: string,
  kind: 'info' | 'error' | 'yesno' = 'info',
): number {
  return deps.exec('powershell.exe', powershellArgs(buildMessageBoxScript(message, undefined, kind)));
}

/** ثبت حجم تخمینی و نسخه در نقشه (برای رجیستری). */
export function withSize(layout: InstallLayout, bytes: number): InstallLayout {
  return { ...layout, estimatedSizeKb: Math.max(1, Math.round(bytes / 1024)) };
}

/** استفادهٔ داخلی: اطمینان از وجود کلیدهای رجیستری ساخته‌شده (تست/عیب‌یابی). */
export function registryCommandCount(layout: InstallLayout, version: string): number {
  return buildRegistryCommands(layout, version).length;
}

export type { InstallLayout };
