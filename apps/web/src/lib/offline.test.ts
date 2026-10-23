import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllLocalData,
  enqueueAttendance,
  flushQueue,
  getRoster,
  listQueue,
  queueSummary,
  saveRoster,
  subscribeQueue,
  type QueuedOperation,
} from './offline.js';
import { setOnline } from '../test/setup.js';

const base = {
  classId: 'c1',
  className: 'هفتم الف',
  day: '2026-10-20',
  periodNo: 1,
  records: [{ studentId: 's1', status: 'present' }],
};

beforeEach(async () => {
  await clearAllLocalData();
  setOnline(true);
});

describe('صف آفلاین و همگام‌سازی', () => {
  it('عملیات ذخیره‌شده پس از بازخوانی برنامه در صف باقی می‌ماند', async () => {
    const op = await enqueueAttendance(base);
    const list = await listQueue();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(op.id);
    expect(list[0]!.status).toBe('pending');
    expect(list[0]!.payload).toMatchObject({ source: 'offline', classId: 'c1' });
    expect((list[0]!.payload as { capturedAt: string }).capturedAt).toBeTruthy();
  });

  it('هر عملیات شناسه یکتای پایدار دارد و کلید idempotency همان شناسه است', async () => {
    const a = await enqueueAttendance(base);
    const b = await enqueueAttendance(base);
    expect(a.id).not.toBe(b.id);
    const sender = vi.fn(async (op: QueuedOperation) => {
      expect(op.id).toBeTruthy();
      return { ids: ['server-1'] };
    });
    await flushQueue(sender);
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('پس از تأیید سرور وضعیت synced می‌شود', async () => {
    await enqueueAttendance(base);
    const result = await flushQueue(async () => ({ ids: ['srv-1'] }));
    expect(result.sent).toBe(1);
    const [op] = await listQueue();
    expect(op!.status).toBe('synced');
    expect(op!.serverIds).toEqual(['srv-1']);
    expect((await queueSummary()).pending).toBe(0);
  });

  it('خطای شبکه عملیات را حذف نمی‌کند و تلاش مجدد را زمان‌بندی می‌کند', async () => {
    await enqueueAttendance(base);
    const result = await flushQueue(async () => {
      throw new Error('network down');
    });
    expect(result.errors).toBe(1);
    const [op] = await listQueue();
    expect(op!.status).toBe('pending');
    expect(op!.attempts).toBe(1);
    expect(op!.nextAttemptAt).toBeTruthy();
    expect((await queueSummary()).pending).toBe(1);
  });

  it('در حالت آفلاین هیچ ارسالی انجام نمی‌شود', async () => {
    await enqueueAttendance(base);
    setOnline(false);
    const sender = vi.fn(async () => ({}));
    const result = await flushQueue(sender);
    expect(result.sent).toBe(0);
    expect(sender).not.toHaveBeenCalled();
    expect((await queueSummary()).pending).toBe(1);
  });

  it('تعارض (۴۰۹) به وضعیت conflict با جزئیات منتقل می‌شود', async () => {
    await enqueueAttendance(base);
    const { ApiError } = await import('./api.js');
    await flushQueue(async () => {
      throw new ApiError(409, 'CONFLICT', 'قبلاً ثبت شده', { existing: [{ studentId: 's1' }] });
    });
    const [op] = await listQueue();
    expect(op!.status).toBe('conflict');
    expect(op!.details).toEqual({ existing: [{ studentId: 's1' }] });
    expect((await queueSummary()).conflict).toBe(1);
  });

  it('انقضای نشست (۴۰۱) صف را حفظ و وضعیت needs_auth می‌دهد', async () => {
    await enqueueAttendance(base);
    await enqueueAttendance({ ...base, periodNo: 2 });
    const { ApiError } = await import('./api.js');
    const sender = vi.fn(async () => {
      throw new ApiError(401, 'UNAUTHORIZED', 'ورود لازم است');
    });
    await flushQueue(sender);
    expect(sender).toHaveBeenCalledTimes(1);
    const list = await listQueue();
    expect(list.map((o) => o.status)).toEqual(['needs_auth', 'pending']);
  });

  it('خطای ۴xx غیرقابل بازیابی ناموفق اعلام می‌شود', async () => {
    await enqueueAttendance(base);
    const { ApiError } = await import('./api.js');
    await flushQueue(async () => {
      throw new ApiError(400, 'BAD_REQUEST', 'تاریخ آینده مجاز نیست');
    });
    const [op] = await listQueue();
    expect(op!.status).toBe('failed');
    expect(op!.error).toContain('آینده');
  });

  it('ارسال مجدد عملیات تأییدشده انجام نمی‌شود (idempotency سمت کلاینت)', async () => {
    await enqueueAttendance(base);
    await flushQueue(async () => ({ ids: ['srv'] }));
    const sender = vi.fn(async () => ({}));
    const second = await flushQueue(sender);
    expect(second.sent).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });

  it('فهرست کلاس برای حالت آفلاین کش و قابل بازیابی است', async () => {
    await saveRoster({
      classId: 'c1',
      className: 'هفتم الف',
      students: [{ id: 's1', first_name: 'سارا', last_name: 'نمونه' }],
      savedAt: new Date().toISOString(),
    });
    const cached = await getRoster('c1');
    expect(cached?.students).toHaveLength(1);
    expect(cached?.className).toBe('هفتم الف');
  });

  it('پاک‌سازی داده محلی صف و فهرست‌ها را حذف می‌کند', async () => {
    await enqueueAttendance(base);
    await saveRoster({ classId: 'c1', className: 'x', students: [], savedAt: new Date().toISOString() });
    await clearAllLocalData();
    expect(await listQueue()).toEqual([]);
    expect(await getRoster('c1')).toBeUndefined();
  });

  it('گوش‌دهنده‌ها با تغییر صف مطلع می‌شوند', async () => {
    const listener = vi.fn();
    const unsub = subscribeQueue(listener);
    await enqueueAttendance(base);
    expect(listener).toHaveBeenCalled();
    unsub();
  });
});
