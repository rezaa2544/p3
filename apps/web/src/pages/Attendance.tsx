import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api, errorMessage, isNetworkError } from '../lib/api.js';
import {
  discardOperation,
  enqueueAttendance,
  flushQueue,
  getRoster,
  listQueue,
  newOperationId,
  saveRoster,
  subscribeQueue,
  type QueuedOperation,
} from '../lib/offline.js';
import { ATTENDANCE_LABELS, formatDate, formatDateTime, formatNumber, fullName, statusBadgeClass, todayISO } from '../lib/format.js';
import type { AttendanceRecord, Options, Student } from '../lib/types.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Loading, Modal, PageHeader, Select, toast } from '../components/ui.js';

type DraftStatus = Record<string, string>;

const STATUS_ORDER = ['present', 'absent', 'late', 'excused', 'sick', 'early_leave'];

export function AttendancePage() {
  const [params, setParams] = useSearchParams();
  const [options, setOptions] = useState<Options | null>(null);
  const [classId, setClassId] = useState(params.get('classId') ?? '');
  const [day, setDay] = useState(todayISO());
  const [periodNo, setPeriodNo] = useState(0);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [rosterFromCache, setRosterFromCache] = useState(false);
  const [draft, setDraft] = useState<DraftStatus>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<AttendanceRecord[]>([]);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [savedInfo, setSavedInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<QueuedOperation | null>(null);
  const [showQueue, setShowQueue] = useState(false);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await listQueue());
    } catch {
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    void refreshQueue();
    return subscribeQueue(() => void refreshQueue());
  }, [refreshQueue]);

  useEffect(() => {
    api<Options>('/meta/options')
      .then((o) => {
        setOptions(o);
        setClassId((current) => current || o.classes[0]?.id || '');
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const loadRoster = useCallback(
    async (targetClass: string) => {
      if (!targetClass) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api<{ items: Student[] }>(`/students?classId=${targetClass}&limit=200`);
        setStudents(res.items);
        setRosterFromCache(false);
        const className = options?.classes.find((c) => c.id === targetClass)?.title ?? 'کلاس';
        await saveRoster({ classId: targetClass, className, students: res.items, savedAt: new Date().toISOString() });
      } catch (e) {
        const cached = await getRoster(targetClass);
        if (cached) {
          setStudents(cached.students.map((s) => ({ ...s, status: 'active', class_id: cached.classId, class_title: s.class_title ?? null })));
          setRosterFromCache(true);
          setError('اتصال به سرور برقرار نشد؛ فهرست ذخیره‌شده روی این دستگاه نمایش داده می‌شود.');
        } else {
          setError(errorMessage(e));
        }
      } finally {
        setLoading(false);
      }
    },
    [options],
  );

  useEffect(() => {
    if (classId) {
      setDraft({});
      setExisting([]);
      setSavedInfo(null);
      void loadRoster(classId);
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('classId', classId);
        return next;
      }, { replace: true });
    }
  }, [classId, loadRoster, setParams]);

  const loadExisting = useCallback(async () => {
    if (!classId) return;
    try {
      const res = await api<{ items: AttendanceRecord[] }>(`/attendance?classId=${classId}&day=${day}`);
      setExisting(res.items.filter((r) => Number(r.period_no) === periodNo && r.day === day));
    } catch {
      setExisting([]);
    }
  }, [classId, day, periodNo]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  const className = options?.classes.find((c) => c.id === classId)?.title ?? '';

  const progress = useMemo(() => {
    if (!students) return { done: 0, total: 0 };
    return { done: students.filter((s) => draft[s.id]).length, total: students.length };
  }, [students, draft]);

  const setAll = (status: string) => {
    if (!students) return;
    const next: DraftStatus = {};
    for (const s of students) next[s.id] = status;
    setDraft(next);
  };

  const submit = async () => {
    if (!students || students.length === 0) return;
    const selected = students.filter((s) => draft[s.id]);
    if (selected.length === 0) {
      setError('برای هیچ دانش‌آموزی وضعیت انتخاب نشده است.');
      return;
    }
    if (!navigator.onLine) {
      await enqueueAndReport(selected);
      return;
    }
    setBusy(true);
    setError(null);
    setSavedInfo(null);
    const idem = newOperationId();
    try {
      const res = await api<{ saved: number; serverTime: string }>('/attendance', {
        method: 'POST',
        headers: { 'idempotency-key': idem },
        body: {
          classId,
          day,
          periodNo,
          source: 'online',
          records: selected.map((s) => ({ studentId: s.id, status: draft[s.id]! })),
        },
      });
      setSavedInfo(`ثبت در سرور تأیید شد — ${formatNumber(res.saved)} دانش‌آموز — ${formatDateTime(res.serverTime)}`);
      setDraft({});
      toast('حضور با تأیید سرور ثبت شد', 'success');
      void loadExisting();
    } catch (e) {
      if (isNetworkError(e)) {
        await enqueueAndReport(selected);
        return;
      }
      if (e instanceof ApiError && e.status === 409) {
        setError(
          'برای این روز/زنگ قبلاً حضور ثبت شده است. برای اصلاح از گزارش حضور استفاده کنید. ' +
            (typeof e.details === 'object' && e.details && 'hint' in (e.details as object)
              ? String((e.details as { hint?: string }).hint ?? '')
              : ''),
        );
        void loadExisting();
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const enqueueAndReport = async (selected: Student[]) => {
    try {
      await enqueueAttendance({
        classId,
        className,
        day,
        periodNo,
        records: selected.map((s) => ({ studentId: s.id, status: draft[s.id]! })),
      });
      setDraft({});
      setShowQueue(true);
      toast('اتصال برقرار نیست؛ ثبت در صف محلی ذخیره شد و پس از اتصال ارسال می‌شود', 'default');
      const result = await flushQueue();
      if (result.sent > 0) await refreshQueue();
    } catch (e) {
      setError(`ذخیره محلی ناموفق بود: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="ثبت حضور و غیاب"
        subtitle="ثبت شما فقط پس از تأیید سرور قطعی است. در حالت آفلاین، عملیات در صف محلی نگه‌داری می‌شود."
        actions={
          <>
            <Button size="sm" onClick={() => setShowQueue(true)}>
              صف عملیات ({formatNumber(queue.filter((q) => q.status !== 'synced').length)})
            </Button>
          </>
        }
      />

      <Card className="mb-3">
        <div className="form-row">
          <Field label="کلاس" htmlFor="class-select">
            <Select id="class-select" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">— انتخاب کلاس —</option>
              {options?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="تاریخ (میلادی؛ معادل شمسی نمایش داده می‌شود)" htmlFor="day">
            <input
              id="day"
              className="input"
              type="date"
              dir="ltr"
              value={day}
              max={todayISO()}
              onChange={(e) => setDay(e.target.value)}
            />
            <span className="hint">{formatDate(day)}</span>
          </Field>
          <Field label="زنگ / ساعت" htmlFor="period">
            <Select id="period" value={periodNo} onChange={(e) => setPeriodNo(Number(e.target.value))}>
              <option value={0}>حضور روزانه</option>
              {[1, 2, 3, 4, 5, 6, 7].map((p) => (
                <option key={p} value={p}>
                  زنگ {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="row between">
          <div className="row">
            <Button size="sm" onClick={() => setAll('present')} disabled={!students?.length}>
              همه حاضر
            </Button>
            <Button size="sm" onClick={() => setDraft({})} disabled={!students?.length}>
              پاک‌کردن انتخاب‌ها
            </Button>
          </div>
          <span className="small soft">
            {students ? `${formatNumber(progress.done)} از ${formatNumber(progress.total)} نفر مشخص شده` : ''}
          </span>
        </div>
      </Card>

      {error ? (
        <div className="mb-3">
          <Alert tone={rosterFromCache ? 'warning' : 'error'}>{error}</Alert>
        </div>
      ) : null}
      {savedInfo ? (
        <div className="mb-3">
          <Alert tone="success">{savedInfo}</Alert>
        </div>
      ) : null}

      {existing.length > 0 ? (
        <div className="mb-3">
          <Alert tone="info">
            برای این روز و زنگ قبلاً حضور ثبت شده است ({formatNumber(existing.length)} رکورد). ثبت دوباره مسدود است؛ برای
            اصلاح به گزارش حضور بروید.
          </Alert>
        </div>
      ) : null}

      <Card>
        <div className="card-head">
          <h2>
            {className || 'دانش‌آموزان'} {rosterFromCache ? <Badge tone="warning">فهرست ذخیره‌شده</Badge> : null}
          </h2>
          <div className="row">
            <Button variant="primary" onClick={() => void submit()} disabled={busy || !students?.length || existing.length > 0}>
              {busy ? 'در حال ارسال…' : navigator.onLine ? 'ثبت و ارسال به سرور' : 'ذخیره در صف آفلاین'}
            </Button>
          </div>
        </div>
        {loading ? <Loading /> : null}
        {!loading && students && students.length === 0 ? (
          <EmptyState title="دانش‌آموزی در این کلاس نیست" description="ابتدا از بخش دانش‌آموزان، ثبت‌نام را انجام دهید." />
        ) : null}
        {!loading && students?.length ? (
          <div>
            {students.map((s) => (
              <div className="att-row" key={s.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{fullName(s.first_name, s.last_name)}</div>
                  <div className="hint">{s.class_title ?? className}</div>
                </div>
                <div className="att-status" role="group" aria-label={`وضعیت ${fullName(s.first_name, s.last_name)}`}>
                  {STATUS_ORDER.map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={draft[s.id] === status}
                      onClick={() => setDraft((d) => ({ ...d, [s.id]: status }))}
                    >
                      {ATTENDANCE_LABELS[status]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {existing.length > 0 ? (
        <Card className="mt-4">
          <div className="card-head">
            <h2>ثبت‌های موجود این روز/زنگ</h2>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>دانش‌آموز</th>
                  <th>وضعیت</th>
                  <th>منبع</th>
                  <th>زمان ثبت سرور</th>
                  <th>ثبت‌کننده</th>
                </tr>
              </thead>
              <tbody>
                {existing.map((r) => (
                  <tr key={r.id}>
                    <td>{fullName(r.first_name, r.last_name)}</td>
                    <td>
                      <Badge tone={statusBadgeClass(r.status)}>{ATTENDANCE_LABELS[r.status] ?? r.status}</Badge>
                    </td>
                    <td>{r.source === 'offline' ? 'آفلاین همگام‌شده' : 'آنلاین'}</td>
                    <td>{formatDateTime(r.recorded_at)}</td>
                    <td>{r.recorded_by_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Modal open={showQueue} onClose={() => setShowQueue(false)} title="صف عملیات این دستگاه">
        {queue.length === 0 ? (
          <EmptyState title="صف خالی است" description="عملیات ثبت‌شده در حالت آفلاین اینجا نمایش داده می‌شود." />
        ) : (
          <div className="grid" style={{ gap: 10 }}>
            {queue.map((op) => (
              <div key={op.id} className="card tight">
                <div className="row between">
                  <strong className="small">{op.label}</strong>
                  <Badge
                    tone={
                      op.status === 'synced' ? 'success' : op.status === 'conflict' ? 'danger' : op.status === 'failed' ? 'warning' : 'info'
                    }
                  >
                    {op.status === 'synced'
                      ? 'تأییدشده توسط سرور'
                      : op.status === 'conflict'
                        ? 'تعارض'
                        : op.status === 'failed'
                          ? 'ناموفق'
                          : op.status === 'needs_auth'
                            ? 'نیاز به ورود'
                            : op.status === 'sending'
                              ? 'در حال ارسال'
                              : 'در انتظار ارسال'}
                  </Badge>
                </div>
                <div className="hint">{formatDateTime(op.createdAt)}</div>
                {op.error ? <div className="small" style={{ color: 'var(--c-danger)' }}>{op.error}</div> : null}
                {op.status === 'conflict' ? (
                  <Button size="sm" className="mt-2" onClick={() => setConflict(op)}>
                    بررسی تعارض
                  </Button>
                ) : null}
                {op.status !== 'synced' ? (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => void discardOperation(op.id)}>
                    حذف از صف
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal open={Boolean(conflict)} onClose={() => setConflict(null)} title="تعارض همگام‌سازی">
        {conflict ? (
          <>
            <p className="small">
              این عملیات با داده‌ای که قبلاً روی سرور ثبت شده سازگار نیست. هیچ داده‌ای به‌صورت خودکار بازنویسی نشد. برای ادامه،
              وضعیت المان‌های درگیر را بررسی و سپس تصمیم بگیرید.
            </p>
            <pre className="small" dir="ltr" style={{ background: 'var(--c-surface-2)', padding: 8, borderRadius: 6, overflow: 'auto' }}>
              {JSON.stringify(conflict.details, null, 2)}
            </pre>
            <Button
              size="sm"
              onClick={() => {
                void loadExisting();
                setConflict(null);
                setShowQueue(false);
              }}
            >
              نمایش ثبت‌های سرور
            </Button>
          </>
        ) : null}
      </Modal>
    </>
  );
}
