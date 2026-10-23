import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDateTime, formatNumber, roleLabel } from '../lib/format.js';
import type { AuditRow } from '../lib/types.js';
import { Alert, Button, Card, EmptyState, Field, Input, Loading, PageHeader, Pagination } from '../components/ui.js';

export function AuditPage() {
  const [data, setData] = useState<{ items: AuditRow[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (action.trim()) qs.set('action', action.trim());
      if (from) qs.set('from', from);
      setData(await api<{ items: AuditRow[]; total: number }>(`/audit?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [page, action, from]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader title="رویدادهای حساس (Audit Log)" subtitle="عملیات حساس با زمان، کاربر و شناسه درخواست ثبت می‌شود." />
      <Card className="mb-3">
        <div className="form-row">
          <Field label="نوع عملیات" htmlFor="a" hint="مثال: attendance.correct یا grades.approve">
            <Input id="a" dir="ltr" value={action} onChange={(e) => setAction(e.target.value)} />
          </Field>
          <Field label="از تاریخ" htmlFor="f">
            <input id="f" className="input" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <Button size="sm" onClick={() => void load()}>
              اعمال فیلتر
            </Button>
          </div>
        </div>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        {!data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <EmptyState title="رویدادی یافت نشد" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>زمان</th>
                    <th>کاربر</th>
                    <th>نقش</th>
                    <th>عملیات</th>
                    <th>موجودیت</th>
                    <th>IP</th>
                    <th>شناسه درخواست</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.created_at)}</td>
                      <td>{r.actor_name ?? '—'}</td>
                      <td>{roleLabel(r.actor_role) || '—'}</td>
                      <td dir="ltr">{r.action}</td>
                      <td dir="ltr">
                        {r.entity}
                        {r.entity_id ? `: ${r.entity_id.slice(0, 8)}` : ''}
                      </td>
                      <td dir="ltr">{r.ip ?? '—'}</td>
                      <td dir="ltr">{r.request_id ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} total={data.total} limit={limit} onChange={setPage} />
            <p className="hint">مجموع: {formatNumber(data.total)} رویداد</p>
          </>
        )}
      </Card>
    </>
  );
}
