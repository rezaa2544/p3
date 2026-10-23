import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
import { formatNumber, fullName } from '../lib/format.js';
import type { ReportCard } from '../lib/types.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Loading, PageHeader, Select } from '../components/ui.js';
import { useAuth } from '../state/auth.js';

export function ReportCardPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [studentId, setStudentId] = useState(params.get('studentId') ?? '');
  const [students, setStudents] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [card, setCard] = useState<ReportCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSelfService = me?.role === 'student' || me?.role === 'guardian';

  useEffect(() => {
    if (isSelfService) {
      void loadCard(studentId || undefined);
      if (me?.role === 'guardian') {
        api<{ items: { id: string; first_name: string; last_name: string }[] }>('/me/children')
          .then((res) => {
            setStudents(res.items);
            if (!studentId && res.items[0]) setStudentId(res.items[0].id);
          })
          .catch(() => undefined);
      }
      return;
    }
    api<{ items: { id: string; first_name: string; last_name: string }[] }>('/students?limit=200')
      .then((res) => {
        setStudents(res.items);
        if (!studentId && res.items[0]) setStudentId(res.items[0].id);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [isSelfService]);

  useEffect(() => {
    if (studentId) {
      void loadCard(studentId);
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set('studentId', studentId);
        return next;
      }, { replace: true });
    }
  }, [studentId]);

  const loadCard = async (id?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<ReportCard>(id ? `/report-card?studentId=${id}` : '/report-card');
      setCard(res);
    } catch (e) {
      setCard(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="کارنامه"
        subtitle="میانگین‌ها فقط از نمرات تأییدشده محاسبه می‌شوند و نمرات ناقص به‌صورت شفاف اعلام می‌شوند."
        actions={
          <Button size="sm" onClick={() => window.print()} className="no-print">
            چاپ کارنامه
          </Button>
        }
      />
      {!isSelfService ? (
        <Card className="mb-3 no-print">
          <Field label="دانش‌آموز" htmlFor="student">
            <Select id="student" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">— انتخاب دانش‌آموز —</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s.first_name, s.last_name)}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      ) : me?.role === 'guardian' && students.length > 1 ? (
        <Card className="mb-3 no-print">
          <Field label="فرزند" htmlFor="child">
            <Select id="child" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {fullName(s.first_name, s.last_name)}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}
      {loading ? <Loading /> : null}

      {card && !loading ? (
        <Card>
          <div className="card-head">
            <div>
              <h2 style={{ marginBottom: 2 }}>کارنامه دانش‌آموز</h2>
              <div className="soft">{fullName(card.student.first_name, card.student.last_name)}</div>
            </div>
            <div className="row">
              <Badge tone="primary">مدرسه: {me?.memberships.find((m) => m.schoolId === me.activeSchoolId)?.schoolName ?? '—'}</Badge>
              {card.overall.hasData ? (
                <Badge tone={card.overall.average !== null && card.overall.average >= 10 ? 'success' : 'warning'}>
                  معدل: {formatNumber(card.overall.average)}
                </Badge>
              ) : null}
            </div>
          </div>

          {card.dataNotice ? (
            <div className="mb-3">
              <Alert tone="warning">{card.dataNotice}</Alert>
            </div>
          ) : null}

          {card.subjects.length === 0 ? (
            <EmptyState title="داده کافی برای کارنامه وجود ندارد" description="پس از ثبت و تأیید نمرات، کارنامه ساخته می‌شود." />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>درس</th>
                    <th>میانگین (از ۲۰)</th>
                    <th>نمرات محاسبه‌شده</th>
                    <th>نمرات ناقص</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {card.subjects.map((s) => (
                    <tr key={s.subjectId}>
                      <td>{s.subjectTitle}</td>
                      <td className="num">{s.average === null ? 'داده موجود نیست' : formatNumber(s.average)}</td>
                      <td className="num">{formatNumber(s.counted)}</td>
                      <td className="num">{formatNumber(s.missing + s.excluded)}</td>
                      <td>
                        {s.result === 'no-data' ? (
                          <Badge>بدون داده</Badge>
                        ) : s.result === 'incomplete' ? (
                          <Badge tone="warning">ناقص</Badge>
                        ) : s.result === 'pass' ? (
                          <Badge tone="success">قبول</Badge>
                        ) : (
                          <Badge tone="danger">نیازمند تجدیدنظر</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {card.subjects.length > 0 ? (
            <>
              <div className="divider" />
              <h3>جزئیات ارزیابی‌ها</h3>
              {card.subjects.map((s) => (
                <div key={s.subjectId} className="mb-3">
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{s.subjectTitle}</div>
                  <div className="row">
                    {s.assessments.map((a) => (
                      <Badge key={a.id} tone={a.approved ? (a.score === null ? 'warning' : 'success') : ''}>
                        {a.title}: {a.score === null ? 'ثبت نشده' : formatNumber(a.score)} از {formatNumber(a.maxScore)}
                        {a.approved ? '' : ' (تأییدنشده)'}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : null}
          <p className="hint mt-3 mb-0">
            این کارنامه بر اساس داده ثبت‌شده در سرور تولید شده است. مبنای محاسبه: میانگین وزنی نمرات تأییدشده، نرمال‌شده به مقیاس ۲۰.
          </p>
        </Card>
      ) : null}
    </>
  );
}
