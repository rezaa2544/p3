import { globalOne, globalQuery } from '../db.js';
import { hashPassword, newToken } from '../security/password.js';

/**
 * آماده‌سازی نخستین اجرا (نصب تازه / نسخه‌ی اجرایی).
 *
 * - هیچ رمز پیش‌فرض عمومی وجود ندارد: اگر ADMIN_PASSWORD تنظیم نشده باشد یک رمز
 *   تصادفی تولید و تنها یک‌بار روی خروجی فرایند چاپ می‌شود.
 * - نسخهٔ میزکار (EXE) اعتبارنامهٔ مشخصی برای «نخستین ورود» می‌گذارد (۱۲۳۴۵۶/۱۲۳۴۵۶).
 *   این استثنا فقط با پرچم صریح `PAYESH_ALLOW_SHORT_ADMIN_PASSWORD=1` پذیرفته می‌شود که
 *   تنها بستهٔ میزکار آن را تنظیم می‌کند؛ سرور عمومی بدون آن هر رمز کوتاه را رد می‌کند.
 *   حساب ساخته‌شده همیشه `must_change_password` دارد، پس رمز کوتاه فقط یک‌بار کار می‌کند.
 * - مدیر ساخته‌شده must_change_password دارد.
 * - یک مدرسه، سال تحصیلی جاری و ترم اول ساخته می‌شود تا سامانه از همان ابتدا
 *   قابل استفاده باشد (بدون مدرسه، هیچ صفحه‌ای داده‌ای ندارد).
 */
export type FirstSetupResult = {
  created: boolean;
  username?: string;
  orgId?: string;
  temporaryPassword?: string;
  schoolId?: string;
  schoolName?: string;
  academicYearId?: string;
  termId?: string;
  reason?: string;
};

function academicYearWindow(now = new Date()) {
  // سال تحصیلی ایران: از اواخر شهریور تا پایان خرداد
  const startYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const startsOn = `${startYear}-09-23`;
  const endsOn = `${startYear + 1}-06-20`;
  const midOn = `${startYear + 1}-01-20`;
  return { startYear, startsOn, endsOn, midOn };
}

export async function ensureFirstSetup(env: NodeJS.ProcessEnv = process.env): Promise<FirstSetupResult> {
  const users = await globalOne<{ n: number }>('select count(*)::int as n from users');
  if ((users?.n ?? 0) > 0) return { created: false, reason: 'کاربر از قبل وجود دارد' };

  const username = env.ADMIN_USERNAME?.trim() || 'admin';
  const fullName = env.ADMIN_NAME?.trim() || 'مدیر سامانه';
  const supplied = env.ADMIN_PASSWORD;
  const allowShort = env.PAYESH_ALLOW_SHORT_ADMIN_PASSWORD === '1';
  if (supplied && supplied.length < 10 && !allowShort) {
    return { created: false, reason: 'ADMIN_PASSWORD کوتاه‌تر از ۱۰ نویسه است' };
  }
  if (supplied && supplied.length < 6) {
    return { created: false, reason: 'رمز نخستین اجرا نباید کوتاه‌تر از ۶ نویسه باشد' };
  }
  const password = supplied ?? newToken(18);

  const hash = await hashPassword(password);
  const row = await globalQuery<{ id: string }>(
    `insert into users (username, password_hash, full_name, is_super_admin, must_change_password)
     values ($1,$2,$3,true,true)
     on conflict (username) do update set password_hash = excluded.password_hash, is_super_admin = true
     returning id`,
    [username, hash, fullName],
  );
  const userId = row[0]!.id;

  const orgName = env.FIRST_ORG_NAME?.trim() || 'مجتمع آموزشی';
  const org = await globalQuery<{ id: string }>(
    'insert into organizations (name) values ($1) returning id',
    [orgName],
  );
  const orgId = org[0]!.id;

  const schoolName = env.FIRST_SCHOOL_NAME?.trim() || 'مدرسه من';
  const schoolCode = env.FIRST_SCHOOL_CODE?.trim() || 'SCH-001';
  const school = await globalQuery<{ id: string }>(
    `insert into schools (org_id, name, code) values ($1,$2,$3)
     on conflict (code) do update set name = excluded.name
     returning id`,
    [orgId, schoolName, schoolCode],
  );
  const schoolId = school[0]!.id;

  const existingMember = await globalOne<{ id: string }>(
    'select id from memberships where user_id = $1 and school_id = $2',
    [userId, schoolId],
  );
  if (!existingMember) {
    await globalQuery('insert into memberships (user_id, school_id, role) values ($1,$2,$3)', [
      userId,
      schoolId,
      'school_admin',
    ]);
  }

  const { startYear, startsOn, endsOn, midOn } = academicYearWindow();
  const year = await globalQuery<{ id: string }>(
    `insert into academic_years (school_id, title, starts_on, ends_on, is_current)
     values ($1,$2,$3,$4,true)
     on conflict (school_id, title) do update set is_current = true
     returning id`,
    [schoolId, env.FIRST_YEAR_TITLE?.trim() || `سال تحصیلی ${startYear}-${startYear + 1}`, startsOn, endsOn],
  );
  const academicYearId = year[0]!.id;

  const term = await globalQuery<{ id: string }>(
    `insert into terms (academic_year_id, title, seq, starts_on, ends_on)
     values ($1,'نیم‌سال اول',1,$2,$3)
     on conflict (academic_year_id, seq) do nothing
     returning id`,
    [academicYearId, startsOn, midOn],
  );
  let termId = term[0]?.id;
  if (!termId) {
    const found = await globalOne<{ id: string }>('select id from terms where academic_year_id = $1 and seq = 1', [
      academicYearId,
    ]);
    termId = found?.id;
  }

  return {
    created: true,
    username,
    orgId,
    temporaryPassword: supplied ? undefined : password,
    schoolId,
    schoolName,
    academicYearId,
    termId,
  };
}
