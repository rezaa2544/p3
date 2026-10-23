import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDate, fullName } from '../lib/format.js';
import type { Options, StudentDetail, StudentList } from '../lib/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Select,
  toast,
} from '../components/ui.js';
import { useAuth } from '../state/auth.js';

export function StudentsPage() {
  const { has } = useAuth();
  const [data, setData] = useState<StudentList | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '25' });
      if (search.trim()) qs.set('search', search.trim());
      if (classId) qs.set('classId', classId);
      setData(await api<StudentList>(`/students?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, search, classId]);

  useEffect(() => {
    api<Options>('/meta/options').then(setOptions).catch(() => undefined);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    try {
      setDetail(await api<StudentDetail>(`/students/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="دانش‌آموزان"
        subtitle="دسترسی شما به دانش‌آموزان بر اساس نقش و کلاس‌های تخصیص‌یافته محدود است."
        actions={
          has('students.manage') ? (
            <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
              ثبت دانش‌آموز
            </Button>
          ) : null
        }
      />
      <Card className="mb-3">
        <div className="form-row">
          <Field label="جست‌وجو" htmlFor="q">
            <Input
              id="q"
              value={search}
              placeholder="نام یا نام خانوادگی"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="کلاس" htmlFor="cls">
            <Select
              id="cls"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">همه کلاس‌ها</option>
              {options?.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        {loading && !data ? <Loading /> : null}
        {data && data.items.length === 0 ? (
          <EmptyState title="دانش‌آموزی یافت نشد" description="فیلترها را تغییر دهید یا دانش‌آموز جدید ثبت کنید." />
        ) : null}
        {data && data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>کلاس</th>
                    <th>وضعیت</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id}>
                      <td>{fullName(s.first_name, s.last_name)}</td>
                      <td>{s.class_title ?? 'بدون کلاس'}</td>
                      <td>
                        <Badge tone={s.status === 'active' ? 'success' : ''}>{s.status === 'active' ? 'فعال' : s.status}</Badge>
                      </td>
                      <td>
                        <Button size="sm" onClick={() => void openDetail(s.id)}>
                          پرونده
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} total={data.total} limit={data.limit} onChange={setPage} />
          </>
        ) : null}
      </Card>

      {detail ? <StudentDetailModal detail={detail} onClose={() => setDetail(null)} onChanged={() => void openDetail(detail.student.id)} /> : null}
      {createOpen ? (
        <CreateStudentModal
          options={options}
          onClose={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function CreateStudentModal({ options, onClose }: { options: Options | null; onClose: () => void }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [classId, setClassId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/students', {
        method: 'POST',
        body: {
          firstName,
          lastName,
          nationalId: nationalId ? nationalId : null,
          classId: classId || null,
        },
      });
      toast('دانش‌آموز ثبت شد', 'success');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="ثبت دانش‌آموز جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !firstName || !lastName}>
            {busy ? 'در حال ذخیره…' : 'ثبت'}
          </Button>
          <Button onClick={onClose}>انصراف</Button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="form-row">
        <Field label="نام" htmlFor="fn">
          <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field label="نام خانوادگی" htmlFor="ln">
          <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </Field>
      </div>
      <Field label="کد ملی (اختیاری)" htmlFor="nid" hint="۱۰ رقم؛ ثبت تکراری در همان مدرسه مسدود است">
        <Input id="nid" dir="ltr" inputMode="numeric" value={nationalId} onChange={(e) => setNationalId(e.target.value.replace(/\D/g, '').slice(0, 10))} />
      </Field>
      <Field label="کلاس (اختیاری)" htmlFor="cc">
        <Select id="cc" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">بدون کلاس</option>
          {options?.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}

function StudentDetailModal({
  detail,
  onClose,
  onChanged,
}: {
  detail: StudentDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { has } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [guardianUser, setGuardianUser] = useState('');
  const [relation, setRelation] = useState<'father' | 'mother' | 'other'>('father');
  const [summary, setSummary] = useState<{ attendance: { status: string; n: number }[]; grades: { subject_title: string; average: number }[]; hasGrades: boolean } | null>(null);

  useEffect(() => {
    api<{ attendance: { status: string; n: number }[]; grades: { subject_title: string; average: number }[]; hasGrades: boolean }>(
      `/students/${detail.student.id}/summary`,
    )
      .then(setSummary)
      .catch(() => undefined);
  }, [detail.student.id]);

  const linkGuardian = async () => {
    setError(null);
    try {
      await api(`/students/${detail.student.id}/guardians`, {
        method: 'POST',
        body: { guardianUserId: guardianUser, relation, isPrimary: false, canViewGrades: true, canViewAttendance: true },
      });
      toast('پیوند ولی ثبت شد', 'success');
      setGuardianUser('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal open title={`پرونده — ${fullName(detail.student.first_name, detail.student.last_name)}`} onClose={onClose}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="grid cols-2">
        <div>
          <div className="small soft">کلاس</div>
          <div>{detail.student.class_title ?? 'بدون کلاس'}</div>
        </div>
        <div>
          <div className="small soft">وضعیت</div>
          <div>{detail.student.status === 'active' ? 'فعال' : detail.student.status}</div>
        </div>
        <div>
          <div className="small soft">تاریخ تولد</div>
          <div>{detail.student.birth_date ? formatDate(detail.student.birth_date) : 'ثبت نشده'}</div>
        </div>
        <div>
          <div className="small soft">کد ملی</div>
          <div dir="ltr">{detail.student.user_id ? '—' : '—'}</div>
        </div>
      </div>

      <div className="divider" />
      <h3>خلاصه عملکرد</h3>
      {!summary ? (
        <p className="small soft">در حال بارگذاری…</p>
      ) : (
        <>
          <div className="row">
            {summary.attendance.length === 0 ? (
              <span className="small muted">داده حضور موجود نیست</span>
            ) : (
              summary.attendance.map((a) => (
                <Badge key={a.status} tone={a.status === 'absent' ? 'danger' : a.status === 'late' ? 'warning' : 'success'}>
                  {a.status}: {a.n}
                </Badge>
              ))
            )}
          </div>
          <div className="row mt-2">
            {summary.hasGrades ? (
              summary.grades.map((g) => (
                <Badge key={g.subject_title} tone="info">
                  {g.subject_title}: {g.average}
                </Badge>
              ))
            ) : (
              <span className="small muted">نمره تأییدشده‌ای موجود نیست</span>
            )}
          </div>
        </>
      )}

      {has('users.manage') ? (
        <>
          <div className="divider" />
          <h3>اولیا و سرپرستان</h3>
          {detail.guardians.length === 0 ? (
            <p className="small muted">ولی متصل نشده است.</p>
          ) : (
            <ul className="small">
              {detail.guardians.map((g) => (
                <li key={g.id}>
                  {g.full_name} — {g.relation === 'father' ? 'پدر' : g.relation === 'mother' ? 'مادر' : 'سایر'}
                  {g.is_primary ? ' (ولی اصلی)' : ''}
                </li>
              ))}
            </ul>
          )}
          <div className="form-row">
            <Field label="شناسه کاربر ولی" htmlFor="gu" hint="UUID کاربر با نقش ولی در این مدرسه">
              <Input id="gu" dir="ltr" value={guardianUser} onChange={(e) => setGuardianUser(e.target.value)} />
            </Field>
            <Field label="نسبت" htmlFor="rel">
              <Select id="rel" value={relation} onChange={(e) => setRelation(e.target.value as 'father' | 'mother' | 'other')}>
                <option value="father">پدر</option>
                <option value="mother">مادر</option>
                <option value="other">سایر</option>
              </Select>
            </Field>
          </div>
          <Button size="sm" onClick={() => void linkGuardian()} disabled={!guardianUser}>
            اتصال ولی
          </Button>
        </>
      ) : null}
    </Modal>
  );
}
