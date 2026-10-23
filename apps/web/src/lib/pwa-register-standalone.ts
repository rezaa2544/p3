/**
 * جانشین virtual:pwa-register در ساخت «تک‌فایل HTML».
 * در این حالت Service Worker وجود ندارد، پس ثبت آن هم بی‌معناست.
 */
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
