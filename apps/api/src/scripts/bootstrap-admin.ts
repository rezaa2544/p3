import { readFileSync } from 'node:fs';
import path from 'node:path';
import { closePool, globalQuery } from '../db.js';
import { hashPassword, newToken } from '../security/password.js';
import { ensureDatabase, stopEmbeddedDatabase } from './env.js';

/**
 * ایجاد امن نخستین مدیر سامانه.
 * - بدون رمز پیش‌فرض عمومی: رمز تصادفی تولید و یک‌بار چاپ می‌شود، یا از فایل/محیط خوانده می‌شود.
 * - اگر کاربری از قبل وجود داشته باشد، بدون --force اجرا نمی‌شود.
 */
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const username = process.env.ADMIN_USERNAME ?? 'admin';
  const fullName = process.env.ADMIN_NAME ?? 'مدیر سامانه';
  let password = process.env.ADMIN_PASSWORD;
  if (process.env.ADMIN_PASSWORD_FILE) {
    password = readFileSync(path.resolve(process.env.ADMIN_PASSWORD_FILE), 'utf8').trim();
  }
  const generated = !password;
  if (!password) password = newToken(18);

  await ensureDatabase();
  const existing = await globalQuery<{ n: number }>('select count(*)::int as n from users');
  if ((existing[0]?.n ?? 0) > 0 && !force) {
    throw new Error('کاربر از قبل وجود دارد؛ برای افزودن مدیر دیگر --force بدهید');
  }
  const hash = await hashPassword(password);
  const rows = await globalQuery<{ id: string }>(
    `insert into users (username, password_hash, full_name, is_super_admin, must_change_password)
     values ($1,$2,$3,true,true)
     on conflict (username) do update set password_hash = excluded.password_hash, is_super_admin = true
     returning id`,
    [username, hash, fullName],
  );
  console.log(
    JSON.stringify({
      ok: true,
      userId: rows[0]?.id,
      username,
      temporaryPassword: generated ? password : undefined,
      note: 'رمز در نخستین ورود باید تغییر کند. این خروجی را در جای ناامن نگه ندارید.',
    }),
  );
  await closePool();
  await stopEmbeddedDatabase();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 1;
});
