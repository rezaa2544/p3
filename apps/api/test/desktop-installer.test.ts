import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { defaultLayout, shortcutSpecs } from '../src/desktop/install-plan.js';
import { DesktopError, runInstall, runUninstall, WINDOWS_ONLY_MESSAGE, type InstallerDeps } from '../src/desktop/installer.js';
import {
  DESKTOP_ADMIN_PASSWORD,
  DESKTOP_ADMIN_USERNAME,
  browserCandidates,
  buildBrowserArgs,
  desktopServerEnv,
  healthUrl,
  isInstalledCopy,
  isPayeshHealth,
  parseDesktopArgs,
  pickBrowser,
  resolvePort,
} from '../src/desktop/shell-plan.js';

const paths = {
  localAppData: 'C:\\Users\\مریم احمدی\\AppData\\Local',
  appData: 'C:\\Users\\مریم احمدی\\AppData\\Roaming',
  userProfile: 'C:\\Users\\مریم احمدی',
};

type Fake = InstallerDeps & {
  calls: string[];
  files: Set<string>;
  dirs: Set<string>;
  spawned: string[];
  execCalls: { cmd: string; args: string[] }[];
};

function fakeDeps(platform: NodeJS.Platform = 'win32', seed: string[] = []): Fake {
  const files = new Set(seed);
  const dirs = new Set<string>();
  const fake: Fake = {
    platform,
    calls: [],
    files,
    dirs,
    spawned: [],
    execCalls: [],
    exists: (p) => files.has(p) || dirs.has(p),
    mkdirp: (p) => {
      dirs.add(p);
      fake.calls.push(`mkdir ${p}`);
    },
    copy: (from, to) => {
      files.add(to);
      fake.calls.push(`copy ${from} -> ${to}`);
    },
    remove: (p) => {
      files.delete(p);
      fake.calls.push(`remove ${p}`);
    },
    removeDir: (p) => {
      dirs.delete(p);
      for (const f of [...files]) if (f.startsWith(p)) files.delete(f);
      fake.calls.push(`rmdir ${p}`);
    },
    sizeOf: () => 125_000_000,
    exec: (cmd, args) => {
      fake.execCalls.push({ cmd, args });
      return 0;
    },
    spawnDetached: (cmd) => {
      fake.spawned.push(cmd);
    },
  };
  return fake;
}

describe('اجراکنندهٔ نصب ویندوز (با دیسک و رجیستری تقلبی)', () => {
  it('نصب: پوشه‌ها، کپی خود، سه میان‌بر، رجیستری و اجرا', () => {
    const layout = defaultLayout(paths);
    const deps = fakeDeps('win32', ['C:\\Downloads\\payesh2.exe']);
    const result = runInstall({ layout, selfPath: 'C:\\Downloads\\payesh2.exe', version: '0.1.0', deps });

    expect(result.copied).toBe(true);
    expect(deps.dirs.has(layout.installDir)).toBe(true);
    expect(deps.dirs.has(layout.dataDir)).toBe(true);
    expect(deps.files.has(layout.appExe)).toBe(true);
    // میان‌برها در یک اسکریپت و با WScript.Shell
    const ps = deps.execCalls.filter((c) => c.cmd === 'powershell.exe');
    expect(ps).toHaveLength(1);
    const script = ps[0]!.args.at(-1)!;
    expect(script).toContain('WScript.Shell');
    expect(script.split('$link.Save()').length - 1).toBe(3);
    expect(script).toContain('--uninstall');
    // رجیستری فقط با reg.exe و بدون پوستهٔ فرمان
    const reg = deps.execCalls.filter((c) => c.cmd === 'reg.exe');
    expect(reg.length).toBeGreaterThanOrEqual(10);
    expect(reg.every((c) => c.args[0] === 'add')).toBe(true);
    expect(deps.execCalls.some((c) => c.cmd === 'cmd.exe')).toBe(false);
    expect(deps.spawned).toEqual([layout.appExe]);
  });

  it('نصب از داخل پوشهٔ نصب دوباره فایل را کپی نمی‌کند', () => {
    const layout = defaultLayout(paths);
    const deps = fakeDeps('win32', [layout.appExe]);
    const result = runInstall({ layout, selfPath: layout.appExe, version: '0.1.0', deps });
    expect(result.copied).toBe(false);
    expect(deps.calls.some((c) => c.startsWith('copy'))).toBe(false);
  });

  it('شکست کپی، نصب نیمه‌کاره را پاک می‌کند', () => {
    const layout = defaultLayout(paths);
    const deps = fakeDeps('win32', ['C:\\Downloads\\payesh2.exe']);
    deps.copy = () => {
      throw new Error('disk full');
    };
    expect(() => runInstall({ layout, selfPath: 'C:\\Downloads\\payesh2.exe', version: '0.1.0', deps })).toThrow(
      DesktopError,
    );
    expect(deps.calls.some((c) => c.startsWith('rmdir'))).toBe(true);
  });

  it('حذف: میان‌برها و کلید رجیستری پاک می‌شوند و داده دست‌نخورده می‌ماند', () => {
    const layout = defaultLayout(paths);
    const specs = shortcutSpecs(layout);
    const deps = fakeDeps('win32', [layout.appExe, ...specs.map((s) => s.linkPath)]);
    const result = runUninstall({ layout, deps });

    expect(result.removedShortcuts).toBe(3);
    for (const s of specs) expect(deps.files.has(s.linkPath)).toBe(false);
    expect(deps.files.has(layout.appExe)).toBe(true); // فایل در حال اجرا است
    const reg = deps.execCalls.find((c) => c.cmd === 'reg.exe');
    expect(reg?.args).toEqual(['delete', layout.registryKey, '/f']);
    const removal = deps.execCalls.find((c) => c.cmd === 'powershell.exe')!.args.at(-1)!;
    expect(removal).toContain(`Remove-Item -LiteralPath '${layout.installDir}' -Recurse -Force`);
    expect(removal).not.toContain(layout.dataDir);
  });

  it('روی سیستم غیرویندوزی نصب انجام نمی‌شود', () => {
    const layout = defaultLayout(paths);
    const deps = fakeDeps('linux', ['/tmp/payesh2']);
    const previous = process.env.PAYESH_ALLOW_NON_WINDOWS;
    delete process.env.PAYESH_ALLOW_NON_WINDOWS;
    try {
      expect(() => runInstall({ layout, selfPath: '/tmp/payesh2', version: '0.1.0', deps })).toThrow(
        WINDOWS_ONLY_MESSAGE,
      );
    } finally {
      if (previous !== undefined) process.env.PAYESH_ALLOW_NON_WINDOWS = previous;
    }
  });
});

describe('حالت‌های اجرای فایل میزکار', () => {
  it('آرگومان‌ها به حالت درست تبدیل می‌شوند', () => {
    expect(parseDesktopArgs([]).mode).toBe('app');
    expect(parseDesktopArgs(['--install']).mode).toBe('install');
    expect(parseDesktopArgs(['--uninstall']).mode).toBe('uninstall');
    expect(parseDesktopArgs(['--server']).mode).toBe('server');
    expect(parseDesktopArgs(['--plan']).mode).toBe('plan');
    expect(parseDesktopArgs(['--silent', '--install']).silent).toBe(true);
    expect(parseDesktopArgs(['--reinstall']).reinstall).toBe(true);
    // آرگومان‌های ناشناخته (مثل مسیرهای ویندوز) حالت را عوض نمی‌کنند
    expect(parseDesktopArgs(['C:\\Users\\x\\Downloads\\Payesh2.exe']).mode).toBe('app');
    expect(parseDesktopArgs(['--server', '--uninstall']).mode).toBe('uninstall');
  });

  it('پورت پیش‌فرض محلی است و مقدار نامعتبر نادیده گرفته می‌شود', () => {
    expect(resolvePort({})).toBe(3210);
    expect(resolvePort({ PORT: '3333' })).toBe(3333);
    expect(resolvePort({ PORT: 'abc' })).toBe(3210);
    expect(resolvePort({ PORT: '70000' })).toBe(3210);
    expect(healthUrl(3210)).toBe('http://127.0.0.1:3210/api/health');
  });

  it('سلامت سرور فقط با پاسخ خود پایش ۲ پذیرفته می‌شود', () => {
    expect(isPayeshHealth({ service: 'payesh2-api', status: 'ok' })).toBe(true);
    expect(isPayeshHealth({ service: 'payesh2-api', status: 'degraded' })).toBe(false);
    expect(isPayeshHealth({ service: 'other', status: 'ok' })).toBe(false);
    expect(isPayeshHealth('<html>')).toBe(false);
    expect(isPayeshHealth(undefined)).toBe(false);
  });

  it('مرورگر میزبان از مسیرهای استاندارد ویندوز انتخاب می‌شود', () => {
    const env = {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    } as NodeJS.ProcessEnv;
    const candidates = browserCandidates(env);
    expect(candidates.map((c) => c.path)).toContain(
      path.win32.join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
    const found = pickBrowser(env, (p) => p.includes('Edge') && p.startsWith('C:\\Program Files (x86)'));
    expect(found?.name).toBe('Microsoft Edge');
    expect(pickBrowser(env, () => false)).toBeUndefined();
    const args = buildBrowserArgs('http://127.0.0.1:3210/', 'C:\\Users\\u\\AppData\\Local\\Payesh2\\profile');
    expect(args[0]).toBe('--app=http://127.0.0.1:3210/');
    expect(args).toContain('--user-data-dir=C:\\Users\\u\\AppData\\Local\\Payesh2\\profile');
    expect(args).toContain('--window-size=1280,860');
  });

  it('محیط سرور میزکار فقط روی ۱۲۷٫۰٫۰٫۱ گوش می‌دهد و اعتبارنامهٔ نخستین ورود دارد', () => {
    const env = desktopServerEnv({
      home: 'C:\\Users\\u\\AppData\\Local\\Payesh2',
      port: 3210,
      buildId: 'abc123',
      adminUsername: DESKTOP_ADMIN_USERNAME,
      adminPassword: DESKTOP_ADMIN_PASSWORD,
    });
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.PORT).toBe('3210');
    expect(env.ADMIN_USERNAME).toBe('123456');
    expect(env.ADMIN_PASSWORD).toBe('123456');
    expect(env.PAYESH_ALLOW_SHORT_ADMIN_PASSWORD).toBe('1');
    expect(env.PAYESH_FIRST_ADMIN).toBe('1');
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.APP_ORIGIN).toBe('http://127.0.0.1:3210');
    expect(env.COOKIE_SECURE).toBe('1');
    expect(env.TRUST_PROXY).toBe('0');
    expect(env.SEED_DEMO).toBe('0');
    // دادهٔ کاربر بیرون از پوشهٔ برنامه
    expect(env.PGLITE_DIR).toContain('Payesh2');
  });

  it('تشخیص نسخهٔ نصب‌شده مستقل از بزرگی/کوچکی حروف مسیر است', () => {
    const layout = defaultLayout(paths);
    expect(isInstalledCopy(layout.appExe.toUpperCase(), layout)).toBe(true);
    expect(isInstalledCopy('C:\\Downloads\\payesh2.exe', layout)).toBe(false);
  });
});
