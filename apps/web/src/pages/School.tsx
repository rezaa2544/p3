import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDate, formatNumber } from '../lib/format.js';
import type { AcademicYear, Klass, School, Subject } from '../lib/types.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loading, PageHeader, Tabs, toast } from '../components/ui.js';
import { useAuth } from '../state/auth.js';

type Tab = 'years' | 'classes' | 'subjects' | 'teachers';

export function SchoolPage() {
  const { has } = useAuth();
  const [tab, setTab] = useState<Tab>('years');
  const [school, setSchool] = useState<{ school: School; currentYear: AcademicYear | null } | null>(null);
  const [years, setYears] = useState<AcademicYear[] | null>(null);
  const [classes, setClasses] = useState<Klass[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = has('school.manage');

  const load = useCallback(async () => {
    try {
      const [s, y, c, sub] = await Promise.all([
        api<{ school: School; currentYear: AcademicYear | null }>('/school'),
        api<{ items: AcademicYear[] }>('/academic-years'),
        api<{ items: Klass[] }>('/classes'),
        api<{ items: Subject[] }>('/subjects'),
      ]);
      setSchool(s);
      setYears(y.items);
      setClasses(c.items);
      setSubjects(sub.items);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="مدرسه، سال تحصیلی و کلاس‌ها"
        subtitle={school ? `${school.school.name} — کد ${school.school.code}` : 'در حال بارگذاری…'}
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'years', label: 'سال‌های تحصیلی' },
          { id: 'classes', label: 'کلاس‌ها' },
          { id: 'subjects', label: 'دروس' },
          { id: 'teachers', label: 'تخصیص دبیر' },
        ]}
      />
      {tab === 'years' ? <YearsTab years={years} canManage={canManage} reload={load} /> : null}
      {tab === 'classes' ? <ClassesTab classes={classes} canManage={canManage} reload={load} years={years} /> : null}
      {tab === 'subjects' ? <SubjectsTab subjects={subjects} canManage={canManage} reload={load} /> : null}
      {tab === 'teachers' ? <AssignmentsTab classes={classes} subjects={subjects} canManage={canManage} reload={load} /> : null}
    </>
  );
}

function YearsTab({ years, canManage, reload }: { years: AcademicYear[] | null; canManage: boolean; reload: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    try {
      await api('/academic-years', { method: 'POST', body: { title, startsOn, endsOn, makeCurrent: false } });
      toast('سال تحصیلی ثبت شد', 'success');
      setTitle('');
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const activate = async (id: string) => {
    try {
      await api(`/academic-years/${id}/activate`, { method: 'POST' });
      toast('سال تحصیلی فعال شد؛ سال‌های گذشته فقط خواندنی می‌مانند', 'success');
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!years ? (
        <Loading />
      ) : years.length === 0 ? (
        <EmptyState title="سال تحصیلی تعریف نشده است" />
      ) : (
        <div className="table-wrap mb-3">
          <table className="data">
            <thead>
              <tr>
                <th>عنوان</th>
                <th>شروع</th>
                <th>پایان</th>
                <th>وضعیت</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td>{y.title}</td>
                  <td>{formatDate(y.starts_on)}</td>
                  <td>{formatDate(y.ends_on)}</td>
                  <td>{y.is_current ? <Badge tone="success">جاری</Badge> : <Badge>آرشیو</Badge>}</td>
                  <td>
                    {canManage && !y.is_current ? (
                      <Button size="sm" onClick={() => void activate(y.id)}>
                        فعال‌سازی
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <>
          <h3>سال تحصیلی جدید</h3>
          <div className="form-row">
            <Field label="عنوان" htmlFor="yt">
              <Input id="yt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="۱۴۰۵-۱۴۰۶" />
            </Field>
            <Field label="شروع" htmlFor="ys">
              <input id="ys" className="input" type="date" dir="ltr" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </Field>
            <Field label="پایان" htmlFor="ye">
              <input id="ye" className="input" type="date" dir="ltr" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>
          <Button size="sm" variant="primary" onClick={() => void create()} disabled={!title || !startsOn || !endsOn}>
            ثبت
          </Button>
        </>
      ) : null}
    </Card>
  );
}

function ClassesTab({
  classes,
  canManage,
  reload,
  years,
}: {
  classes: Klass[] | null;
  canManage: boolean;
  reload: () => Promise<void>;
  years: AcademicYear[] | null;
}) {
  const [title, setTitle] = useState('');
  const [capacity, setCapacity] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const current = years?.find((y) => y.is_current);

  const create = async () => {
    try {
      await api('/classes', { method: 'POST', body: { title, capacity: Number(capacity) } });
      toast('کلاس ایجاد شد', 'success');
      setTitle('');
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!classes ? (
        <Loading />
      ) : classes.length === 0 ? (
        <EmptyState title="کلاسی تعریف نشده است" description="ابتدا یک سال تحصیلی فعال داشته باشید." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>کلاس</th>
                <th>پایه</th>
                <th>تعداد دانش‌آموز</th>
                <th>ظرفیت</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td>{c.grade_level ?? '—'}</td>
                  <td className="num">{formatNumber(c.students)}</td>
                  <td className="num">{c.capacity ? formatNumber(c.capacity) : '—'}</td>
                  <td>{c.is_active ? <Badge tone="success">فعال</Badge> : <Badge>غیرفعال</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <div className="mt-4">
          <h3>کلاس جدید {current ? `— سال ${current.title}` : ''}</h3>
          <div className="form-row">
            <Field label="عنوان کلاس" htmlFor="ct">
              <Input id="ct" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="هفتم ب" />
            </Field>
            <Field label="ظرفیت" htmlFor="cc">
              <Input id="cc" type="number" dir="ltr" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          </div>
          <Button size="sm" variant="primary" onClick={() => void create()} disabled={!title || !current}>
            ایجاد
          </Button>
          {!current ? <p className="hint">برای ایجاد کلاس، ابتدا یک سال تحصیلی را فعال کنید.</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

function SubjectsTab({ subjects, canManage, reload }: { subjects: Subject[] | null; canManage: boolean; reload: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [hours, setHours] = useState('2');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    try {
      await api('/subjects', { method: 'POST', body: { title, code, weeklyHours: Number(hours) } });
      toast('درس ایجاد شد', 'success');
      setTitle('');
      setCode('');
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!subjects ? (
        <Loading />
      ) : subjects.length === 0 ? (
        <EmptyState title="درسی تعریف نشده است" />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>درس</th>
                <th>کد</th>
                <th>ساعت هفتگی</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td dir="ltr">{s.code}</td>
                  <td className="num">{s.weekly_hours ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <div className="mt-4">
          <h3>درس جدید</h3>
          <div className="form-row">
            <Field label="عنوان" htmlFor="st">
              <Input id="st" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="کد" htmlFor="sc">
              <Input id="sc" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field label="ساعت هفتگی" htmlFor="sh">
              <Input id="sh" type="number" dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          </div>
          <Button size="sm" variant="primary" onClick={() => void create()} disabled={!title || !code}>
            ایجاد
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

type TeachingRow = {
  id: string;
  class_id: string;
  class_title: string;
  subject_id: string;
  subject_title: string;
  teacher_user_id: string;
  teacher_name: string;
};

function AssignmentsTab({
  classes,
  subjects,
  canManage,
  reload,
}: {
  classes: Klass[] | null;
  subjects: Subject[] | null;
  canManage: boolean;
  reload: () => Promise<void>;
}) {
  const [rows, setRows] = useState<TeachingRow[] | null>(null);
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([]);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [res, users] = await Promise.all([
        api<{ items: TeachingRow[] }>('/teaching-assignments'),
        api<{ items: { id: string; full_name: string }[] }>('/users?role=teacher&limit=200'),
      ]);
      setRows(res.items);
      setTeachers(users.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    try {
      await api('/teaching-assignments', { method: 'POST', body: { classId, subjectId, teacherUserId: teacherId } });
      toast('تخصیص دبیر ثبت شد', 'success');
      await load();
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title="تخصیصی ثبت نشده است" description="برای ثبت حضور و نمره، دبیر باید به کلاس/درس تخصیص داشته باشد." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>کلاس</th>
                <th>درس</th>
                <th>دبیر</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.class_title}</td>
                  <td>{r.subject_title}</td>
                  <td>{r.teacher_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <div className="mt-4">
          <h3>تخصیص دبیر به درس و کلاس</h3>
          <div className="form-row">
            <Field label="کلاس" htmlFor="ac">
              <select id="ac" className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">— انتخاب —</option>
                {classes?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="درس" htmlFor="as">
              <select id="as" className="select" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">— انتخاب —</option>
                {subjects?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="دبیر" htmlFor="at">
              <select id="at" className="select" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                <option value="">— انتخاب —</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button size="sm" variant="primary" onClick={() => void create()} disabled={!classId || !subjectId || !teacherId}>
            ثبت تخصیص
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
