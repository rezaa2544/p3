import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDateTime, formatNumber } from '../lib/format.js';
import type { Assignment, Options, Submission } from '../lib/types.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, toast } from '../components/ui.js';
import { useAuth } from '../state/auth.js';

export function AssignmentsPage() {
  const { me, has } = useAuth();
  const [items, setItems] = useState<Assignment[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Assignment | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Assignment[] }>('/assignments')).items);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    api<Options>('/meta/options').then(setOptions).catch(() => undefined);
  }, [load]);

  const isTeacher = me?.role === 'teacher' || has('assignments.manage');

  return (
    <>
      <PageHeader
        title="تکالیف"
        subtitle={isTeacher ? 'تکالیف منتشرنشده فقط برای شما قابل مشاهده است.' : 'فقط تکالیف منتشرشده کلاس شما نمایش داده می‌شود.'}
        actions={
          isTeacher ? (
            <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
              تکلیف جدید
            </Button>
          ) : null
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        {!items ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="تکلیفی ثبت نشده است" description={isTeacher ? 'با دکمه «تکلیف جدید» شروع کنید.' : 'تکالیف منتشرشده اینجا نمایش داده می‌شود.'} />
        ) : (
          <div className="grid" style={{ gap: 10 }}>
            {items.map((a) => {
              const overdue = new Date(a.due_at).getTime() < Date.now();
              return (
                <div key={a.id} className="card tight">
                  <div className="row between">
                    <div>
                      <strong>{a.title}</strong>
                      <div className="hint">
                        {a.class_title} — {a.subject_title} — مهلت {formatDateTime(a.due_at)}
                      </div>
                    </div>
                    <div className="row">
                      {!a.published_at ? <Badge tone="warning">پیش‌نویس</Badge> : overdue ? <Badge>پایان مهلت</Badge> : <Badge tone="success">فعال</Badge>}
                      <Button size="sm" onClick={() => setSelected(a)}>
                        {me?.role === 'student' ? 'مشاهده و ارسال' : 'پاسخ‌ها'}
                      </Button>
                    </div>
                  </div>
                  {a.description ? <p className="small mt-2 mb-0">{a.description}</p> : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {createOpen ? (
        <CreateAssignmentModal
          options={options}
          onClose={() => {
            setCreateOpen(false);
            void load();
          }}
        />
      ) : null}
      {selected ? <SubmissionModal assignment={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function CreateAssignmentModal({ options, onClose }: { options: Options | null; onClose: () => void }) {
  const [classId, setClassId] = useState(options?.classes[0]?.id ?? '');
  const [subjectId, setSubjectId] = useState(options?.subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxScore, setMaxScore] = useState('20');
  const [publish, setPublish] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/assignments', {
        method: 'POST',
        body: {
          classId,
          subjectId,
          title,
          description: description || undefined,
          dueAt: new Date(`${dueDate}T20:00:00`).toISOString(),
          maxScore: maxScore ? Number(maxScore) : null,
          allowSubmission: true,
          publish,
        },
      });
      toast('تکلیف ایجاد شد', 'success');
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
      title="تکلیف جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !title || !dueDate || !classId || !subjectId}>
            {busy ? 'در حال ذخیره…' : publish ? 'ایجاد و انتشار' : 'ذخیره پیش‌نویس'}
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
      <Field label="عنوان" htmlFor="t">
        <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="توضیحات" htmlFor="d">
        <Textarea id="d" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="form-row">
        <Field label="مهلت" htmlFor="due">
          <input id="due" className="input" type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="سقف نمره" htmlFor="m">
          <Input id="m" type="number" min={1} max={100} dir="ltr" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
        انتشار فوری برای دانش‌آموزان
      </label>
    </Modal>
  );
}

function SubmissionModal({ assignment, onClose }: { assignment: Assignment; onClose: () => void }) {
  const { me, has } = useAuth();
  const [items, setItems] = useState<Submission[] | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ id: string; score: string; feedback: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Submission[] }>(`/assignments/${assignment.id}/submissions`)).items);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [assignment.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      await api(`/assignments/${assignment.id}/submissions`, { method: 'POST', body: { body } });
      toast('پاسخ ارسال شد', 'success');
      setBody('');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendReview = async () => {
    if (!review) return;
    setBusy(true);
    try {
      await api(`/submissions/${review.id}/review`, {
        method: 'POST',
        body: { score: review.score === '' ? null : Number(review.score), feedback: review.feedback || undefined },
      });
      toast('بازخورد ثبت شد', 'success');
      setReview(null);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const isStudent = me?.role === 'student';

  return (
    <Modal open title={assignment.title} onClose={onClose}>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {assignment.description ? <p className="small">{assignment.description}</p> : null}
      <p className="hint">مهلت: {formatDateTime(assignment.due_at)} — سقف نمره: {assignment.max_score ? formatNumber(Number(assignment.max_score)) : '—'}</p>

      {isStudent && assignment.allow_submission ? (
        <>
          <Field label="پاسخ شما" htmlFor="answer">
            <Textarea id="answer" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy || body.trim().length === 0}>
            ارسال پاسخ
          </Button>
        </>
      ) : null}

      <div className="divider" />
      <h3>وضعیت ارسال</h3>
      {!items ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState title="پاسخی ارسال نشده است" />
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {items.map((s) => (
            <div key={s.id} className="card tight">
              <div className="row between">
                <span className="small">
                  {s.first_name ? `${s.first_name} ${s.last_name ?? ''}` : 'پاسخ شما'} — {formatDateTime(s.submitted_at)}
                </span>
                <Badge tone={s.status === 'reviewed' ? 'success' : s.status === 'late' ? 'warning' : 'info'}>
                  {s.status === 'reviewed' ? 'بررسی‌شده' : s.status === 'late' ? 'با تأخیر' : 'ارسال‌شده'}
                </Badge>
              </div>
              {s.body ? <p className="small mt-2 mb-0">{s.body}</p> : null}
              {s.score !== null ? (
                <div className="small mt-2">
                  نمره: <strong>{formatNumber(Number(s.score))}</strong> {s.feedback ? `— ${s.feedback}` : ''}
                </div>
              ) : null}
              {!isStudent && has('assignments.manage') ? (
                <Button size="sm" className="mt-2" onClick={() => setReview({ id: s.id, score: '', feedback: '' })}>
                  ثبت بازخورد
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {review ? (
        <div className="mt-3">
          <Field label="نمره" htmlFor="score">
            <Input id="score" type="number" dir="ltr" value={review.score} onChange={(e) => setReview({ ...review, score: e.target.value })} />
          </Field>
          <Field label="بازخورد" htmlFor="fb">
            <Textarea id="fb" value={review.feedback} onChange={(e) => setReview({ ...review, feedback: e.target.value })} style={{ minHeight: 60 }} />
          </Field>
          <Button size="sm" variant="primary" onClick={() => void sendReview()} disabled={busy}>
            ثبت
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
