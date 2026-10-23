import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDate, formatNumber, todayISO } from '../lib/format.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Loading, PageHeader, Stat } from '../components/ui.js';
import { useAuth } from '../state/auth.js';

type Overview = {
  range: { from: string; to: string };
  attendance: { total: number; absent: number; late: number };
  grades: { approved: number; pending: number; average: number | null };
  assignments: { active: number; overdue: number };
  hasData: boolean;
};

export function ReportsPage() {
  const { me } = useAuth();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<Overview>(`/reports/overview?from=${from}&to=${to}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="گزارش‌های مدیریتی"
        subtitle={`بازه ${formatDate(from)} تا ${formatDate(to)} — شاخص‌ها فقط از داده واقعی محاسبه می‌شوند.`}
        actions={
          <Button size="sm" onClick={() => window.print()} className="no-print">
            چاپ
          </Button>
        }
      />
      <Card className="mb-3 no-print">
        <div className="form-row">
          <Field label="از" htmlFor="f">
            <input id="f" className="input" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="تا" htmlFor="t">
            <input id="t" className="input" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <>
          {!data.hasData ? (
            <div className="mb-3">
              <Alert tone="info">در این بازه داده ثبت‌شده‌ای وجود ندارد؛ شاخص‌ها صفر نمایش داده نمی‌شوند.</Alert>
            </div>
          ) : null}
          <div className="grid cols-4 mb-3">
            <Stat label="رکوردهای حضور" value={data.attendance.total > 0 ? formatNumber(data.attendance.total) : null} />
            <Stat
              label="غیبت‌ها"
              value={data.attendance.total > 0 ? formatNumber(data.attendance.absent) : null}
              hint={data.attendance.total > 0 ? `${formatNumber(data.attendance.late)} تأخیر` : undefined}
            />
            <Stat label="نمرات تأییدشده" value={data.grades.approved > 0 ? formatNumber(data.grades.approved) : null} hint={`${formatNumber(data.grades.pending)} در انتظار تأیید`} />
            <Stat label="میانگین کل" value={data.grades.average === null ? null : formatNumber(data.grades.average)} />
          </div>
          <div className="grid cols-2">
            <Card>
              <div className="card-head">
                <h2>تکالیف</h2>
              </div>
              <div className="row">
                <Badge tone="success">فعال: {formatNumber(data.assignments.active)}</Badge>
                <Badge tone="warning">پایان مهلت: {formatNumber(data.assignments.overdue)}</Badge>
              </div>
            </Card>
            <Card>
              <div className="card-head">
                <h2>مدرسه فعال</h2>
              </div>
              <p className="small soft mb-0">
                {me?.memberships.find((m) => m.schoolId === me.activeSchoolId)?.schoolName ?? '—'} — نقش شما: {me?.role}
              </p>
            </Card>
          </div>
        </>
      ) : null}
      {!data && !loading ? <EmptyState title="داده‌ای برای نمایش نیست" /> : null}
    </>
  );
}
