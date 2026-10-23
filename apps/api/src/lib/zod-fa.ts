import { z } from 'zod';
import fa from 'zod/v4/locales/fa.js';

/**
 * پیام‌های اعتبارسنجی به فارسی.
 *
 * zod به‌صورت پیش‌فرض پیام‌هایش را انگلیسی می‌دهد («Invalid input: expected string…»)؛
 * این پیام‌ها در پاسخ API و در رابط کاربری فارسی دیده می‌شوند. از نسخهٔ ۴ به بعد zod
 * بستهٔ زبان فارسی دارد؛ آن را فعال می‌کنیم و نام نوع‌های داده را هم به فارسی برمی‌گردانیم
 * تا جملهٔ نهایی کاملاً فارسی باشد (پیام‌های سفارشی هر schema دست‌نخورده می‌مانند).
 */
const TYPE_NAMES: Record<string, string> = {
  string: 'متن',
  number: 'عدد',
  integer: 'عدد صحیح',
  boolean: 'درست/نادرست',
  array: 'فهرست',
  object: 'شیء',
  null: 'خالی',
  undefined: 'تعریف‌نشده',
  bigint: 'عدد بزرگ',
  symbol: 'نماد',
  date: 'تاریخ',
  nan: 'عدد نامعتبر',
  function: 'تابع',
};

const TYPE_PATTERN = new RegExp(`(?<!["'])\\b(${Object.keys(TYPE_NAMES).join('|')})\\b(?!["'])`, 'g');
const faIssueMessage = fa().localeError;

z.config({
  customError: (issue) => {
    const message = faIssueMessage(issue);
    if (typeof message !== 'string') return message;
    return message.replace(TYPE_PATTERN, (match) => TYPE_NAMES[match] ?? match);
  },
});
