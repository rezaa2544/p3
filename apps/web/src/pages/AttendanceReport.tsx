import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadFile, errorMessage } from '../lib/api.js';
import { ATTENDANCE_LABELS, formatDate, formatDateTime, formatNumber, fullName, statusBadgeClass, todayISO } from '../lib/format.js';
import type { AttendanceRecord, Options } from '../lib/types.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Loading, PageHeader, Select } from '../components/ui.js';

type ReportRow = {
  student_id: string;
  first_name: string;
  last_name: string;
  class_title: string | null;
  present: number;
  absent: number;
  late: number;
  early_leave: number;
  excused: number;
  sick: number;
  total: number;
};

export function AttendanceReportPage() {
  const [params] = useSearchParams();
  const studentId = params.get('studentId');
  const [options, setOptions] = useState<Options | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(todayISO());
  const [classId, setClassId] = useState('');
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Options>('/meta/options')
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (studentId) {
        const res = await api<{ items: AttendanceRecord[] }>(`/me/attendance?studentId=${studentId}&from=${from}&to=${to}`);
        setRecords(res.items);
        setRows(null);
      } else {
        const res = await api<{ items: ReportRow[] }>(`/attendance/report?from=${from}&to=${to}${classId ? `&classId=${classId}` : ''}`);
        setRows(res.items);
        setRecords(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, classId, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = async () => {
    try {
      await downloadFile(`/reports/attendance.csv?from=${from}&to=${to}${classId ? `&classId=${classId}` : ''}`, `attendance-${from}_${to}.csv`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title={studentId ? 'حضور و غیاب دانش‌آموز' : 'گزارش حضور و غیاب'}
        subtitle={`بازه ${formatDate(from)} تا ${formatDate(to)}`}
        actions={
          <>
            <Button size="sm" onClick={() => window.print()} className="no-print">
              چاپ
            </Button>
            {!studentId ? (
              <Button size="sm" variant="primary" onClick={() => void exportCsv()}>
                خروجی CSV
              </Button>
            ) : null}
          </>
        }
      />
      <Card className="mb-3 no-print">
        <div className="form-row">
          <Field label="از تاریخ" htmlFor="from">
            <input id="from" className="input" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="تا تاریخ" htmlFor="to">
            <input id="to" className="input" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {!studentId ? (
            <Field label="کلاس" htmlFor="cls">
              <Select id="cls" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">همه کلاس‌ها</option>
                {options?.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading ? <Loading /> : null}

      {!loading && records ? (
        <Card>
          <div className="card-head">
            <h2>رکوردهای حضور</h2>
          </div>
          {records.length === 0 ? (
            <EmptyState title="داده‌ای در این بازه موجود نیست" description="برای بازه یا کلاس دیگری تلاش کنید." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>تاریخ</th>
                    <th>زنگ</th>
                    <th>وضعیت</th>
                    <th>یادداشت</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDate(r.day)}</td>
                      <td>{r.period_no === 0 ? 'روزانه' : formatNumber(r.period_no)}</td>
                      <td>
                        <Badge tone={statusBadgeClass(r.status)}>{ATTENDANCE_LABELS[r.status] ?? r.status}</Badge>
                      </td>
                      <td>{r.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {!loading && rows ? (
        <Card>
          <div className="card-head">
            <h2>جمع‌بندی بر اساس دانش‌آموز</h2>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="داده‌ای در این بازه موجود نیست" description="اگر انتظار داده داشتید، ثبت حضور دبیران را بررسی کنید." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>دانش‌آموز</th>
                    <th>کلاس</th>
                    <th>حاضر</th>
                    <th>غایب</th>
                    <th>تأخیر</th>
                    <th>موجه</th>
                    <th>بیمار</th>
                    <th>مجموع</th>
                    <th>هشدار</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.student_id}>
                      <td>{fullName(r.first_name, r.last_name)}</td>
                      <td>{r.class_title ?? '—'}</td>
                      <td className="num">{formatNumber(r.present)}</td>
                      <td className="num">{formatNumber(r.absent)}</td>
                      <td className="num">{formatNumber(r.late)}</td>
                      <td className="num">{formatNumber(r.excused)}</td>
                      <td className="num">{formatNumber(r.sick)}</td>
                      <td className="num">{formatNumber(r.total)}</td>
                      <td>
                        {r.absent >= 3 || r.late >= 3 ? (
                          <Badge tone="warning">نیازمند پیگیری</Badge>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint mt-3 mb-0">آمار بر اساس رکوردهای ثبت‌شده و تأییدشده سرور محاسبه شده است — آخرین به‌روزرسانی: {formatDateTime(new Date())}</p>
        </Card>
      ) : null}
    </>
  );
}
