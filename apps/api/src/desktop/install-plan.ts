/**
 * «نقشهٔ نصب» — همهٔ مسیرها و دستورهای نصب ویندوز به‌صورت دادهٔ خالص.
 *
 * چرا جدا از اجراکننده: نصب واقعی فقط روی ویندوز ممکن است، اما ساختن مسیرها، نقل‌قول
 * ایمن فرمان‌ها و اسکریپت میان‌بر با دادهٔ خالص روی هر سیستمی آزمون‌پذیر است. اجراکننده
 * (`installer.ts`) فقط همین نقشه را پیاده می‌کند.
 *
 * الگوی نصب: per-user در `%LOCALAPPDATA%\Programs\Payesh2` — بدون نیاز به دسترسی مدیر،
 * بدون پنجرهٔ UAC، با میان‌بر منوی شروع، میان‌بر دسکتاپ و ثبت در «افزودن یا حذف برنامه‌ها».
 * یک فایل اجرایی (همان فایل نصب) هم برنامه است و هم حذف‌کننده (`--uninstall`)، بنابراین
 * نسخهٔ دومی از بسته لازم نیست و حجم نصب دو برابر نمی‌شود.
 */
import path from 'node:path';

export const APP_DISPLAY_NAME = 'پایش ۲';
export const APP_FOLDER_NAME = 'Payesh2';
export const APP_EXE_NAME = 'Payesh2.exe';
export const REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Payesh2';
export const UNINSTALL_SWITCH = '--uninstall';

export type WindowsPaths = {
  localAppData: string;
  appData: string;
  userProfile: string;
};

export type InstallLayout = {
  installDir: string;
  appExe: string;
  startMenuLink: string;
  desktopLink: string;
  /** میان‌بر «حذف پایش ۲» در منوی شروع */
  startMenuUninstallLink: string;
  dataDir: string;
  logDir: string;
  registryKey: string;
  /** دستور «حذف» که در رجیستری ثبت می‌شود (همان فایل اجرایی با پارامتر) */
  uninstallCommand: string;
  /** آرگومان‌های حالت حذف */
  uninstallArgs: string[];
  /** فرمان اجرای برنامه پس از نصب */
  launchArgs: string[];
  estimatedSizeKb?: number;
};

/**
 * نقل‌قول تک‌نویسه‌ای PowerShell: تنها قاعدهٔ امن، دوبرابرکردن `'` است.
 * (مسیرهایی که نام کاربری فارسی یا فاصله دارند هم درست کار می‌کنند.)
 */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function defaultLayout(paths: WindowsPaths): InstallLayout {
  const installDir = path.win32.join(paths.localAppData, 'Programs', APP_FOLDER_NAME);
  const appExe = path.win32.join(installDir, APP_EXE_NAME);
  const startMenuDir = path.win32.join(paths.appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return {
    installDir,
    appExe,
    startMenuLink: path.win32.join(startMenuDir, `${APP_DISPLAY_NAME}.lnk`),
    desktopLink: path.win32.join(paths.userProfile, 'Desktop', `${APP_DISPLAY_NAME}.lnk`),
    startMenuUninstallLink: path.win32.join(startMenuDir, `حذف ${APP_DISPLAY_NAME}.lnk`),
    dataDir: path.win32.join(paths.localAppData, APP_FOLDER_NAME, 'data'),
    logDir: path.win32.join(paths.localAppData, APP_FOLDER_NAME, 'logs'),
    registryKey: REGISTRY_KEY,
    uninstallCommand: `"${appExe}" ${UNINSTALL_SWITCH}`,
    uninstallArgs: [UNINSTALL_SWITCH],
    launchArgs: [appExe],
    estimatedSizeKb: undefined,
  };
}

/** مسیرهای ویندوز از متغیرهای محیطی؛ آزمون‌پذیر و مستقل از ویندوز بودن دستگاه. */
export function layoutFromEnv(env: NodeJS.ProcessEnv, home = env.USERPROFILE ?? ''): InstallLayout {
  const localAppData = env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local');
  const appData = env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming');
  return defaultLayout({ localAppData, appData, userProfile: home });
}

export type ShortcutSpec = {
  linkPath: string;
  targetPath: string;
  workingDirectory: string;
  arguments?: string;
  description?: string;
  iconPath?: string;
};

/**
 * اسکریپت PowerShell برای ساخت میان‌بر استاندارد ویندوز (.lnk) با WScript.Shell.
 * این روش به هیچ ابزار بیرونی (NSIS/Inno) نیاز ندارد و روی همهٔ نسخه‌های ویندوز کار می‌کند.
 */
export function buildShortcutScript(shortcuts: ShortcutSpec[]): string {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '$shell = New-Object -ComObject WScript.Shell',
  ];
  for (const s of shortcuts) {
    lines.push(
      `$link = $shell.CreateShortcut(${psQuote(s.linkPath)})`,
      `$link.TargetPath = ${psQuote(s.targetPath)}`,
      `$link.WorkingDirectory = ${psQuote(s.workingDirectory)}`,
    );
    if (s.arguments) lines.push(`$link.Arguments = ${psQuote(s.arguments)}`);
    if (s.description) lines.push(`$link.Description = ${psQuote(s.description)}`);
    if (s.iconPath) lines.push(`$link.IconLocation = ${psQuote(`${s.iconPath},0`)}`);
    lines.push('$link.Save()');
  }
  return lines.join('\r\n');
}

/** میان‌برهایی که نصب می‌سازد (منوی شروع، دسکتاپ و «حذف»). */
export function shortcutSpecs(layout: InstallLayout): ShortcutSpec[] {
  return [
    {
      linkPath: layout.startMenuLink,
      targetPath: layout.appExe,
      workingDirectory: layout.installDir,
      description: `${APP_DISPLAY_NAME} — سامانهٔ مدیریت مدرسه`,
      iconPath: layout.appExe,
    },
    {
      linkPath: layout.desktopLink,
      targetPath: layout.appExe,
      workingDirectory: layout.installDir,
      description: `${APP_DISPLAY_NAME} — سامانهٔ مدیریت مدرسه`,
      iconPath: layout.appExe,
    },
    {
      linkPath: layout.startMenuUninstallLink,
      targetPath: layout.appExe,
      workingDirectory: layout.installDir,
      arguments: UNINSTALL_SWITCH,
      description: `حذف ${APP_DISPLAY_NAME}`,
      iconPath: layout.appExe,
    },
  ];
}

/** دستورهای reg.exe برای ثبت برنامه در «افزودن یا حذف برنامه‌ها» (per-user، بدون UAC). */
export function buildRegistryCommands(layout: InstallLayout, version: string, publisher = APP_DISPLAY_NAME): string[][] {
  const values: [string, string, string][] = [
    ['DisplayName', 'REG_SZ', APP_DISPLAY_NAME],
    ['DisplayVersion', 'REG_SZ', version],
    ['Publisher', 'REG_SZ', publisher],
    ['InstallLocation', 'REG_SZ', layout.installDir],
    ['DisplayIcon', 'REG_SZ', `${layout.appExe},0`],
    ['UninstallString', 'REG_SZ', layout.uninstallCommand],
    ['QuietUninstallString', 'REG_SZ', layout.uninstallCommand],
    ['InstallDate', 'REG_SZ', new Date().toISOString().slice(0, 10).replace(/-/g, '')],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
  ];
  const cmds = values.map(([name, type, data]) => ['add', layout.registryKey, '/v', name, '/t', type, '/d', data, '/f']);
  if (layout.estimatedSizeKb) {
    cmds.push([
      'add',
      layout.registryKey,
      '/v',
      'EstimatedSize',
      '/t',
      'REG_DWORD',
      '/d',
      String(Math.max(1, Math.round(layout.estimatedSizeKb))),
      '/f',
    ]);
  }
  return cmds;
}

/** فرمان‌های حذف میان‌بر و کلید رجیستری هنگام uninstall. */
export function buildUninstallSteps(layout: InstallLayout): { removeFiles: string[]; registryCommands: string[][] } {
  return {
    removeFiles: [layout.startMenuLink, layout.desktopLink, layout.startMenuUninstallLink],
    registryCommands: [['delete', layout.registryKey, '/f']],
  };
}

/**
 * اسکریپت حذف فایل‌ها پس از بسته‌شدن برنامه: ویندوز اجازهٔ پاک‌کردن فایل اجراییِ در حال
 * اجرا را نمی‌دهد، پس یک فرایند PowerShell جداگانه چند لحظه صبر می‌کند و پوشه را پاک می‌کند.
 * داده‌ها (`dataDir`) به‌طور پیش‌فرض نگه داشته می‌شوند تا حذف برنامه باعث از دست رفتن
 * اطلاعات مدرسه نشود؛ پاک‌کردن داده فقط با `removeData` صریح.
 */
export function buildRemovalScript(layout: InstallLayout, opts: { removeData?: boolean; waitMs?: number } = {}): string {
  const wait = opts.waitMs ?? 2500;
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `Start-Sleep -Milliseconds ${wait}`,
    `Remove-Item -LiteralPath ${psQuote(path.win32.join(layout.installDir, APP_EXE_NAME))} -Force`,
    `Remove-Item -LiteralPath ${psQuote(layout.installDir)} -Recurse -Force`,
  ];
  if (opts.removeData) {
    lines.push(
      `Remove-Item -LiteralPath ${psQuote(layout.dataDir)} -Recurse -Force`,
      `Remove-Item -LiteralPath ${psQuote(path.win32.dirname(layout.logDir))} -Recurse -Force`,
    );
  }
  return lines.join('\r\n');
}

/**
 * فرمان نمایش پیام ویندوزی — چون برنامه زیرسیستم GUI است و کنسول ندارد.
 * `kind: 'yesno'` برای تأیید حذف؛ پاسخ «بله» با کد خروج ۶ برمی‌گردد.
 */
export function buildMessageBoxScript(
  message: string,
  title = APP_DISPLAY_NAME,
  kind: 'info' | 'error' | 'yesno' = 'info',
): string {
  const icon = kind === 'error' ? 'Error' : 'Information';
  const buttons = kind === 'yesno' ? 'YesNo' : 'OK';
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Windows.Forms',
    `$r = [System.Windows.Forms.MessageBox]::Show(${psQuote(message)}, ${psQuote(title)}, [System.Windows.Forms.MessageBoxButtons]::${buttons}, [System.Windows.Forms.MessageBoxIcon]::${icon})`,
    ...(kind === 'yesno' ? ['if ($r -eq [System.Windows.Forms.DialogResult]::Yes) { exit 6 }'] : []),
  ].join('\r\n');
}

export type InstallStep =
  | { kind: 'mkdir'; path: string }
  | { kind: 'copy'; from: string; to: string }
  | { kind: 'shortcut'; spec: ShortcutSpec }
  | { kind: 'registry'; args: string[] }
  | { kind: 'run'; exe: string; args: string[] };

/**
 * نقشهٔ گام‌به‌گام نصب — همان چیزی که installer.ts اجرا می‌کند و آزمون هم می‌سنجد.
 * `selfPath` همان فایل اجراییِ در حال اجراست (نصب‌کننده = برنامه).
 */
export function planInstall(input: {
  layout: InstallLayout;
  selfPath: string;
  selfBytes: number;
  shortcuts?: ShortcutSpec[];
  version: string;
}): InstallStep[] {
  const { layout, selfPath, selfBytes, version } = input;
  const shortcuts = input.shortcuts ?? shortcutSpecs(layout);
  const samePath = selfPath.toLowerCase() === layout.appExe.toLowerCase();
  const steps: InstallStep[] = [
    { kind: 'mkdir', path: layout.installDir },
    { kind: 'mkdir', path: layout.dataDir },
    { kind: 'mkdir', path: layout.logDir },
  ];
  if (!samePath) steps.push({ kind: 'copy', from: selfPath, to: layout.appExe });
  for (const spec of shortcuts) steps.push({ kind: 'shortcut', spec });
  const withSize: InstallLayout = {
    ...layout,
    estimatedSizeKb: layout.estimatedSizeKb ?? Math.max(1, Math.round(selfBytes / 1024)),
  };
  steps.push(...buildRegistryCommands(withSize, version).map<InstallStep>((args) => ({ kind: 'registry', args })));
  steps.push({ kind: 'run', exe: layout.appExe, args: [] });
  return steps;
}
