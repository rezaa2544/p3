import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  APP_DISPLAY_NAME,
  buildMessageBoxScript,
  buildRegistryCommands,
  buildRemovalScript,
  buildShortcutScript,
  buildUninstallSteps,
  defaultLayout,
  layoutFromEnv,
  planInstall,
  psQuote,
  shortcutSpecs,
  UNINSTALL_SWITCH,
} from '../src/desktop/install-plan.js';

const paths = {
  localAppData: 'C:\\Users\\مریم احمدی\\AppData\\Local',
  appData: 'C:\\Users\\مریم احمدی\\AppData\\Roaming',
  userProfile: 'C:\\Users\\مریم احمدی',
};

describe('نقشهٔ نصب ویندوز (per-user، بدون UAC)', () => {
  it('مسیرها استاندارد و مستقل از نام کاربری هستند (فارسی و فاصله)', () => {
    const layout = defaultLayout(paths);
    expect(layout.installDir).toBe('C:\\Users\\مریم احمدی\\AppData\\Local\\Programs\\Payesh2');
    expect(layout.appExe).toBe(path.win32.join(layout.installDir, 'Payesh2.exe'));
    expect(layout.startMenuLink).toBe(
      'C:\\Users\\مریم احمدی\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\پایش ۲.lnk',
    );
    expect(layout.desktopLink).toBe('C:\\Users\\مریم احمدی\\Desktop\\پایش ۲.lnk');
    // داده‌ها بیرون از پوشهٔ برنامه‌اند تا حذف برنامه داده را از بین نبرد
    expect(layout.dataDir).toBe('C:\\Users\\مریم احمدی\\AppData\\Local\\Payesh2\\data');
    expect(layout.dataDir.startsWith(layout.installDir)).toBe(false);
  });

  it('نقشه از متغیرهای محیطی ویندوز ساخته می‌شود (بدون دسترسی به رجیستری)', () => {
    const layout = layoutFromEnv({
      LOCALAPPDATA: 'D:\\Users\\Ali\\AppData\\Local',
      APPDATA: 'D:\\Users\\Ali\\AppData\\Roaming',
      USERPROFILE: 'D:\\Users\\Ali',
    });
    expect(layout.installDir).toBe('D:\\Users\\Ali\\AppData\\Local\\Programs\\Payesh2');
    expect(layout.desktopLink).toBe('D:\\Users\\Ali\\Desktop\\پایش ۲.lnk');
  });

  it('نقل‌قول PowerShell تک‌نویسه‌ای و ایمن است', () => {
    expect(psQuote('C:\\a b')).toBe("'C:\\a b'");
    // تزریق فرمان با نقل‌قول خنثی می‌شود
    expect(psQuote("C:\\x'; Remove-Item C:\\ /r")).toBe("'C:\\x''; Remove-Item C:\\ /r'");
  });

  it('اسکریپت میان‌بر هدف، پوشهٔ کاری و آیکون را درست تنظیم می‌کند', () => {
    const layout = defaultLayout(paths);
    const script = buildShortcutScript([
      {
        linkPath: layout.startMenuLink,
        targetPath: layout.appExe,
        workingDirectory: layout.installDir,
        description: 'سامانه مدیریت مدرسه',
        iconPath: layout.appExe,
      },
    ]);
    expect(script).toContain('New-Object -ComObject WScript.Shell');
    expect(script).toContain(`$link.TargetPath = '${layout.appExe}'`);
    expect(script).toContain(`$link.WorkingDirectory = '${layout.installDir}'`);
    expect(script).toContain('$link.Save()');
    expect(script).toContain('$ErrorActionPreference');
    expect(script.split('\r\n').length).toBeGreaterThan(5);
  });

  it('سه میان‌بر ساخته می‌شود و «حذف» همان فایل اجرایی را با --uninstall صدا می‌زند', () => {
    const layout = defaultLayout(paths);
    const specs = shortcutSpecs(layout);
    expect(specs).toHaveLength(3);
    const uninstall = specs.find((s) => s.linkPath === layout.startMenuUninstallLink);
    expect(uninstall?.targetPath).toBe(layout.appExe);
    expect(uninstall?.arguments).toBe(UNINSTALL_SWITCH);
    // هیچ نسخهٔ دومی از بسته لازم نیست
    expect(specs.some((s) => s.targetPath.includes('Uninstall'))).toBe(false);
  });

  it('رجیستری «افزودن یا حذف برنامه‌ها» کامل است و دستور حذف/اجرا دارد', () => {
    const layout = defaultLayout(paths);
    const cmds = buildRegistryCommands(layout, '0.1.0');
    const flat = cmds.map((c) => c.join(' '));
    expect(layout.registryKey).toBe('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Payesh2');
    expect(flat.some((c) => c.includes('DisplayName') && c.includes('پایش ۲'))).toBe(true);
    expect(flat.some((c) => c.includes('DisplayVersion') && c.includes('0.1.0'))).toBe(true);
    expect(flat.some((c) => c.includes('UninstallString'))).toBe(true);
    expect(layout.uninstallCommand).toBe(`"${layout.appExe}" --uninstall`);
    // همه کلیدها با /f نوشته می‌شوند تا نصب دوباره بی‌خطا باشد
    expect(cmds.every((c) => c.at(-1) === '/f')).toBe(true);
  });

  it('حجم تخمینی وقتی معلوم باشد در رجیستری ثبت می‌شود', () => {
    const layout = { ...defaultLayout(paths), estimatedSizeKb: 1024 };
    const flat = buildRegistryCommands(layout, '0.1.0').map((c) => c.join(' '));
    expect(flat.some((c) => c.includes('EstimatedSize') && c.includes('1024'))).toBe(true);
  });

  it('حذف فقط میان‌برها را پاک می‌کند و داده را نگه می‌دارد', () => {
    const layout = defaultLayout(paths);
    const plan = buildUninstallSteps(layout);
    expect(plan.removeFiles).toContain(layout.startMenuLink);
    expect(plan.removeFiles).toContain(layout.desktopLink);
    expect(plan.removeFiles).toContain(layout.startMenuUninstallLink);
    expect(plan.removeFiles.some((f) => f.includes('data'))).toBe(false);
    expect(plan.registryCommands[0]).toEqual(['delete', layout.registryKey, '/f']);
  });

  it('اسکریپت حذف فایل اجرایی را بعد از بسته‌شدن برنامه پاک می‌کند', () => {
    const layout = defaultLayout(paths);
    const script = buildRemovalScript(layout);
    expect(script).toContain('Start-Sleep -Milliseconds 2500');
    expect(script).toContain(`Remove-Item -LiteralPath '${layout.installDir}' -Recurse -Force`);
    expect(script).not.toContain(layout.dataDir);
    const withData = buildRemovalScript(layout, { removeData: true });
    expect(withData).toContain(layout.dataDir);
  });

  it('نقشهٔ نصب ترتیب درست دارد: پوشه → کپی خود → میان‌بر → رجیستری → اجرا', () => {
    const layout = defaultLayout(paths);
    const steps = planInstall({
      layout,
      version: '0.1.0',
      selfPath: 'C:\\Users\\مریم احمدی\\Downloads\\payesh2.exe',
      selfBytes: 125_000_000,
    });
    const kinds = steps.map((s) => s.kind);
    expect(kinds.slice(0, 3)).toEqual(['mkdir', 'mkdir', 'mkdir']);
    expect(kinds.indexOf('copy')).toBe(3);
    expect(kinds.indexOf('shortcut')).toBeGreaterThan(kinds.lastIndexOf('copy'));
    expect(kinds.indexOf('registry')).toBeGreaterThan(kinds.indexOf('shortcut'));
    expect(kinds.at(-1)).toBe('run');
    const copies = steps.filter((s) => s.kind === 'copy') as { to: string }[];
    expect(copies).toHaveLength(1);
    expect(copies[0]!.to).toBe(layout.appExe);
    expect(steps.some((s) => s.kind === 'run' && s.exe === layout.appExe)).toBe(true);
    // حجم تخمینی از خود فایل اجرایی گرفته می‌شود
    const sizeCmd = steps.find((s) => s.kind === 'registry' && s.args.includes('EstimatedSize'));
    expect(sizeCmd).toBeTruthy();
  });

  it('نصب از داخل پوشهٔ نصب، فایل را دوباره کپی نمی‌کند', () => {
    const layout = defaultLayout(paths);
    const steps = planInstall({ layout, version: '0.1.0', selfPath: layout.appExe, selfBytes: 10 });
    expect(steps.some((s) => s.kind === 'copy')).toBe(false);
  });

  it('پیام ویندوزی فارسی و بدون کنسول ساخته می‌شود', () => {
    const script = buildMessageBoxScript('نصب کامل شد');
    expect(script).toContain('System.Windows.Forms');
    expect(script).toContain('نصب کامل شد');
    expect(script).toContain('SilentlyContinue'); // اگر ویندوز فرم نداشت، نصب نمی‌شکند
    expect(APP_DISPLAY_NAME).toBe('پایش ۲');
  });

  it('پیام تأیید حذف با «بله» کد ۶ برمی‌گرداند', () => {
    const script = buildMessageBoxScript('حذف شود؟', 'پایش ۲', 'yesno');
    expect(script).toContain('MessageBoxButtons]::YesNo');
    expect(script).toContain('exit 6');
    // تزریق از طریق متن پیام خنثی می‌شود
    const injected = buildMessageBoxScript("x'; Remove-Item C:\\ -Recurse; '", 't');
    expect(injected).not.toMatch(/^Remove-Item/m);
  });
});
