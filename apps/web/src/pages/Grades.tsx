import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api, errorMessage } from '../lib/api.js';
import { formatDate, formatNumber, fullName } from '../lib/format.js';
import type { Assessment, GradeRow, Options } from '../lib/types.js';
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
  Select,
  Textarea,
  toast,
} from '../components/ui.js';

const KIND_LABELS: Record<string, string> = {
  quiz: 'آزمونک',
  midterm: 'میان‌ترم',
  final: 'پایانی',
  oral: 'شفاهی',
  project: 'پروژه',
  other: 'سایر',
};

export function GradesPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState('');
  const [selected, setSelected] = useState<Assessment | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Assessment[] }>(`/assessments${classFilter ? `?classId=${classFilter}` : ''}`);
      setAssessments(res.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [classFilter]);

  useEffect(() => {
    api<Options>('/meta/options').then(setOptions).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="ارزیابی و نمرات"
        subtitle="نمرات پس از تأیید معاون/مدیر برای دانش‌آموز و ولی قابل مشاهده می‌شود."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            ارزیابی جدید
          </Button>
        }
      />
      <Card className="mb-3">
        <div className="form-row">
          <Field label="کلاس" htmlFor="filter">
            <Select id="filter" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
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
        {!assessments ? (
          <Loading />
        ) : assessments.length === 0 ? (
          <EmptyState title="ارزیابی‌ای ثبت نشده است" description="با دکمه «ارزیابی جدید» اولین ارزیابی را بسازید." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>عنوان</th>
                  <th>کلاس</th>
                  <th>درس</th>
                  <th>نوع</th>
                  <th>سقف نمره</th>
                  <th>تعداد نمره</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assessments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{a.class_title}</td>
                    <td>{a.subject_title}</td>
                    <td>{KIND_LABELS[a.kind] ?? a.kind}</td>
                    <td className="num">{formatNumber(Number(a.max_score))}</td>
                    <td className="num">{formatNumber(a.grade_count)}</td>
                    <td>
                      <Badge tone={a.status === 'published' ? 'success' : 'info'}>
                        {a.status === 'published' ? 'منتشرشده' : 'پیش‌نویس'}
                      </Badge>
                    </td>
                    <td>
                      <Button size="sm" onClick={() => setSelected(a)}>
                        ثبت/ویرایش نمرات
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected ? (
        <GradeEntryModal
          assessment={selected}
          onClose={() => {
            setSelected(null);
            void load();
          }}
        />
      ) : null}
      {createOpen ? (
        <CreateAssessmentModal
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

function CreateAssessmentModal({ options, onClose }: { options: Options | null; onClose: () => void }) {
  const [classId, setClassId] = useState(options?.classes[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState(options?.subjects[0]?.id ?? '');
  const [termId, setTermId] = useState(options?.terms[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('quiz');
  const [maxScore, setMaxScore] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/assessments', {
        method: 'POST',
        body: { classId, subjectId, termId, title, kind, maxScore, heldOn: null },
      });
      toast('ارزیابی ایجاد شد', 'success');
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
      title="ارزیابی جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !classId || !subjectId || !termId || !title}>
            {busy ? 'در حال ذخیره…' : 'ایجاد'}
          </Button>
          <Button onClick={onClose}>انصراف</Button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="کلاس" htmlFor="c">
        <Select id="c" value={classId} onChange={(e) => setClassId(e.target.value)}>
          {options?.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="درس" htmlFor="s">
        <Select id="s" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          {options?.subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="دوره (نیم‌سال)" htmlFor="t">
        <Select id="t" value={termId} onChange={(e) => setTermId(e.target.value)}>
          {options?.terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="عنوان" htmlFor="title">
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="آزمون میان‌ترم ریاضی" />
      </Field>
      <div className="form-row">
        <Field label="نوع" htmlFor="k">
          <Select id="k" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="سقف نمره" htmlFor="m">
          <Input id="m" type="number" min={1} max={100} step={0.25} value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} />
        </Field>
      </div>
      {options?.classes.length === 0 ? <Alert tone="warning">ابتدا کلاس و تخصیص دبیر را در بخش مدرسه ایجاد کنید.</Alert> : null}
    </Modal>
  );
}

function GradeEntryModal({ assessment, onClose }: { assessment: Assessment; onClose: () => void }) {
  const [rows, setRows] = useState<GradeRow[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approveMode, setApproveMode] = useState(false);
  const [reason, setReason] = useState('');
  const max = Number(assessment.max_score);

  const load = useCallback(async () => {
    try {
      const [grades, students] = await Promise.all([
        api<{ items: GradeRow[] }>(`/assessments/${assessment.id}/grades`),
        api<{ items: { id: string; first_name: string; last_name: string }[] }>(`/students?classId=${assessment.class_id}&limit=200`),
      ]);
      const map = new Map(grades.items.map((g) => [g.student_id, g]));
      const merged: GradeRow[] = students.items.map((s) => {
        const g = map.get(s.id);
        return {
          id: g?.id ?? `new-${s.id}`,
          student_id: s.id,
          first_name: s.first_name,
          last_name: s.last_name,
          score: g?.score ?? null,
          status: g?.status ?? 'draft',
          updated_at: g?.updated_at ?? new Date().toISOString(),
        };
      });
      setRows(merged);
      setValues(Object.fromEntries(merged.map((r) => [r.student_id, r.score === null ? '' : String(Number(r.score))])));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [assessment.id, assessment.class_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const invalid = useMemo(() => {
    const bad: Record<string, string> = {};
    for (const [id, v] of Object.entries(values)) {
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) bad[id] = 'عدد نامعتبر';
      else if (n < 0 || n > max) bad[id] = `باید بین ۰ و ${formatNumber(max)} باشد`;
    }
    return bad;
  }, [values, max]);

  const save = async () => {
    const payload = Object.entries(values)
      .filter(([, v]) => v !== '')
      .map(([studentId, v]) => ({ studentId, score: Number(v) }));
    if (payload.length === 0) {
      setError('هیچ نمره‌ای وارد نشده است.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ saved: number }>(`/assessments/${assessment.id}/grades`, {
        method: 'POST',
        body: { grades: payload },
      });
      toast(`${formatNumber(res.saved)} نمره ثبت شد (در انتظار تأیید)`, 'success');
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setError('نمره تأییدشده از این مسیر قابل تغییر نیست؛ با مدیر تماس بگیرید.');
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ approved: number }>(`/assessments/${assessment.id}/approve`, { method: 'POST', body: {} });
      toast(`${formatNumber(res.approved)} نمره تأیید و منتشر شد`, 'success');
      setApproveMode(false);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const correct = async (row: GradeRow) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/grades/${row.id}`, {
        method: 'PUT',
        body: { score: values[row.student_id] === '' ? null : Number(values[row.student_id]), reason },
      });
      toast('اصلاح ثبت شد', 'success');
      setReason('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={`نمرات — ${assessment.title}`} onClose={onClose}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="row between mb-3">
        <span className="small soft">
          سقف نمره {formatNumber(max)} — کلاس {assessment.class_title}
        </span>
        <Badge tone={assessment.status === 'published' ? 'success' : 'info'}>
          {assessment.status === 'published' ? 'تأییدشده' : 'پیش‌نویس'}
        </Badge>
      </div>
      {!rows ? (
        <Loading />
      ) : (
        <div style={{ maxHeight: '45vh', overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>دانش‌آموز</th>
                <th>نمره</th>
                <th>وضعیت</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.student_id}>
                  <td>{fullName(r.first_name, r.last_name)}</td>
                  <td>
                    <Input
                      type="number"
                      min={0}
                      max={max}
                      step={0.25}
                      dir="ltr"
                      style={{ width: 90, minHeight: 32 }}
                      value={values[r.student_id] ?? ''}
                      aria-invalid={Boolean(invalid[r.student_id])}
                      aria-label={`نمره ${fullName(r.first_name, r.last_name)}`}
                      onChange={(e) => setValues((v) => ({ ...v, [r.student_id]: e.target.value }))}
                      disabled={r.status === 'approved'}
                    />
                    {invalid[r.student_id] ? <div className="error-text">{invalid[r.student_id]}</div> : null}
                  </td>
                  <td>
                    <Badge tone={r.status === 'approved' ? 'success' : r.status === 'submitted' ? 'info' : ''}>
                      {r.status === 'approved' ? 'تأییدشده' : r.status === 'submitted' ? 'ثبت‌شده' : 'ثبت نشده'}
                    </Badge>
                  </td>
                  <td>
                    {r.status === 'approved' ? (
                      <Button size="sm" variant="ghost" onClick={() => void correct(r)} disabled={!reason || busy}>
                        اصلاح
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="divider" />
      <Field label="دلیل اصلاح (برای نمرات تأییدشده الزامی)" htmlFor="reason">
        <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minHeight: 60 }} />
      </Field>
      <div className="row">
        <Button variant="primary" onClick={() => void save()} disabled={busy || Object.keys(invalid).length > 0}>
          {busy ? 'در حال ذخیره…' : 'ذخیره نمرات'}
        </Button>
        {assessment.status !== 'published' ? (
          <Button variant="default" onClick={() => setApproveMode(true)} disabled={busy}>
            تأیید و انتشار
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          بستن
        </Button>
      </div>
      {approveMode ? (
        <div className="mt-3">
          <Alert tone="warning">
            با تأیید، نمرات برای دانش‌آموز و ولی منتشر می‌شود و تغییر آن‌ها فقط با دلیل ثبت‌شده امکان‌پذیر است.
          </Alert>
          <div className="row mt-2">
            <Button variant="danger" onClick={() => void approve()} disabled={busy}>
              تأیید نهایی
            </Button>
            <Button onClick={() => setApproveMode(false)}>انصراف</Button>
          </div>
        </div>
      ) : null}
      <p className="hint mt-3 mb-0">آخرین به‌روزرسانی: {formatDate(new Date())}</p>
    </Modal>
  );
}
