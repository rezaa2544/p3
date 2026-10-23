/**
 * ابزارهای PE برای «دسکتاپ‌سازی» فایل اجرایی Node.
 *
 * چرا لازم است: فایل رسمی Node یک برنامهٔ «کنسولی» است (زیرسیستم CUI) و اجرای آن روی
 * ویندوز همیشه یک پنجرهٔ سیاه CMD باز می‌کند. با تغییر فیلد Subsystem در سرآیند PE به
 * GUI (۲) همان فایل بدون کنسول اجرا می‌شود؛ این تغییر فقط نحوهٔ ساخت پنجره توسط ویندوز
 * را عوض می‌کند و به کد برنامه کاری ندارد. کدهای خروج و آرگومان‌ها دست‌نخورده می‌مانند.
 *
 * آیکون و اطلاعات نسخه هم از طریق منبع‌های PE (resedit) جاسازی می‌شوند تا برنامه در
 * Explorer و «افزودن یا حذف برنامه‌ها» آیکون و نام درست داشته باشد.
 */
import { readFile } from 'node:fs/promises';

export const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
export const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;

/** محل فیلد Subsystem: e_lfanew + 4 (امضا) + 20 (COFF) + 68 (در Optional Header) */
export function subsystemOffset(buf) {
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error('فایل با امضای MZ شروع نمی‌شود');
  const peOffset = buf.readUInt32LE(0x3c);
  if (buf.subarray(peOffset, peOffset + 4).toString('latin1') !== 'PE\0\0') throw new Error('امضای PE یافت نشد');
  const magic = buf.readUInt16LE(peOffset + 24);
  if (magic !== 0x20b && magic !== 0x10b) throw new Error(`قالب PE ناشناخته: 0x${magic.toString(16)}`);
  return peOffset + 24 + 68;
}

export function readPeInfo(buf) {
  const offset = subsystemOffset(buf);
  const peOffset = buf.readUInt32LE(0x3c);
  return {
    machine: buf.readUInt16LE(peOffset + 4),
    pe32plus: buf.readUInt16LE(peOffset + 24) === 0x20b,
    subsystem: buf.readUInt16LE(offset),
    subsystemName:
      buf.readUInt16LE(offset) === IMAGE_SUBSYSTEM_WINDOWS_GUI ? 'GUI' : buf.readUInt16LE(offset) === 3 ? 'CUI' : 'other',
  };
}

/** نسخهٔ جدید بافر با زیرسیستم دلخواه (بافر ورودی تغییر نمی‌کند). */
export function setSubsystem(buf, subsystem) {
  const copy = Buffer.from(buf);
  const offset = subsystemOffset(copy);
  copy.writeUInt16LE(subsystem, offset);
  return copy;
}

/**
 * جاسازی آیکون و اطلاعات نسخه در منابع PE.
 * اگر resedit در دسترس نباشد خطا پرتاب می‌شود (ساخت نباید بی‌صدا ناقص بماند).
 */
export async function applyResources(buf, opts) {
  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  if (opts.iconPath) {
    const ico = await readFile(opts.iconPath);
    const iconFile = ResEdit.Data.IconFile.from(ico);
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      res.entries,
      1,
      1033,
      iconFile.icons.map((i) => i.data),
    );
  }

  if (opts.version) {
    const [maj, min, patch] = String(opts.version)
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
    const info = ResEdit.Resource.VersionInfo.createEmpty();
    info.setFileVersion(maj ?? 0, min ?? 0, patch ?? 0, 0, 1033);
    info.setProductVersion(maj ?? 0, min ?? 0, patch ?? 0, 0, 1033);
    info.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: opts.productName ?? 'Payesh 2',
        FileDescription: opts.description ?? opts.productName ?? 'Payesh 2',
        CompanyName: opts.company ?? 'Payesh 2',
        LegalCopyright: 'Payesh 2 — school management',
        OriginalFilename: opts.exeName ?? 'Payesh2.exe',
        InternalName: 'Payesh2',
      },
    );
    info.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  return Buffer.from(exe.generate());
}

/** خروجی: بافر آمادهٔ نوشتن با منابع و زیرسیستم GUI. */
export async function desktopify(buf, opts) {
  const withResources = await applyResources(buf, opts);
  return setSubsystem(withResources, IMAGE_SUBSYSTEM_WINDOWS_GUI);
}
