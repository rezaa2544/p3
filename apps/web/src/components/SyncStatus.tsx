import { useCallback, useEffect, useState } from 'react';
import { flushQueue, queueSummary, subscribeQueue } from '../lib/offline.js';
import { toast } from './ui.js';

export function SyncStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [summary, setSummary] = useState({ pending: 0, conflict: 0, failed: 0, needsAuth: 0, synced: 0 });
  const [flushing, setFlushing] = useState(false);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await queueSummary());
    } catch {
      /* IndexedDB در دسترس نیست */
    }
  }, []);

  const doFlush = useCallback(async () => {
    if (!navigator.onLine) return;
    setFlushing(true);
    try {
      const result = await flushQueue();
      if (result.sent > 0) toast(`${result.sent} عملیات با تأیید سرور همگام شد`, 'success');
      if (result.conflicts > 0) toast('تعارض در همگام‌سازی؛ برای بررسی به صفحه حضور مراجعه کنید', 'error');
      await refreshSummary();
    } finally {
      setFlushing(false);
    }
  }, [refreshSummary]);

  useEffect(() => {
    void refreshSummary();
    const unsub = subscribeQueue(() => void refreshSummary());
    const onOnline = () => {
      setOnline(true);
      void doFlush();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = window.setInterval(() => {
      if (navigator.onLine) void doFlush();
    }, 60_000);
    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [doFlush, refreshSummary]);

  const hasQueue = summary.pending > 0 || summary.conflict > 0 || summary.failed > 0 || summary.needsAuth > 0;
  if (online && !hasQueue) return null;

  return (
    <div className={`sync-bar ${!online ? 'offline' : hasQueue ? '' : 'ok'}`} role="status">
      <span aria-hidden="true">{!online ? '📴' : summary.conflict > 0 ? '⚠️' : '⏳'}</span>
      <span>
        {!online
          ? 'اتصال اینترنت قطع است. عملیات ثبت‌شده در صف محلی نگهداری می‌شود.'
          : summary.conflict > 0
            ? `${summary.conflict} عملیات نیازمند بررسی تعارض است.`
            : `${summary.pending} عملیات در انتظار همگام‌سازی است.`}
      </span>
      {summary.failed > 0 ? <span className="small">— {summary.failed} عملیات ناموفق</span> : null}
      {summary.needsAuth > 0 ? <span className="small">— نیاز به ورود مجدد</span> : null}
      {online && hasQueue ? (
        <button className="btn sm" onClick={() => void doFlush()} disabled={flushing}>
          {flushing ? 'در حال ارسال…' : 'همگام‌سازی'}
        </button>
      ) : null}
    </div>
  );
}
