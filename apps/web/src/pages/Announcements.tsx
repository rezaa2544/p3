import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import type { Announcement, Options, Notification } from '../lib/types.js';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, toast } from '../components/ui.js';
import { useAuth } from '../state/auth.js';

export function AnnouncementsPage() {
  const { has } = useAuth();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Announcement[] }>('/announcements')).items);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
    api<Options>('/meta/options').then(setOptions).catch(() => undefined);
  }, [load]);

  const markRead = async (id: string) => {
    try {
      await api(`/announcements/${id}/read`, { method: 'POST' });
      setItems((prev) => prev?.map((a) => (a.id === id ? { ...a, is_read: true } : a)) ?? null);
    } catch {
      /* بی‌صدا */
    }
  };

  return (
    <>
      <PageHeader
        title="اطلاعیه‌ها"
        subtitle="اطلاعیه‌ها بر اساس مخاطب (همه، نقش یا کلاس) فیلتر می‌شوند."
        actions={
          has('comms.manage') ? (
            <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
              اطلاعیه جدید
            </Button>
          ) : null
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        {!items ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="اطلاعیه‌ای منتشر نشده است" />
        ) : (
          <div className="grid" style={{ gap: 12 }}>
            {items.map((a) => (
              <div key={a.id} className="card tight" style={{ borderColor: a.is_read ? undefined : 'var(--c-primary)' }}>
                <div className="row between">
                  <strong>{a.title}</strong>
                  <div className="row">
                    {!a.is_read ? <Badge tone="primary">جدید</Badge> : null}
                    <Badge>{a.audience === 'all' ? 'همه' : a.audience === 'role' ? `نقش: ${a.target_role}` : 'کلاس'}</Badge>
                  </div>
                </div>
                <div className="hint">
                  {a.created_by_name} — {formatDateTime(a.published_at ?? a.created_at)}
                </div>
                <p className="mt-2 mb-0" style={{ whiteSpace: 'pre-wrap' }}>
                  {a.body}
                </p>
                {!a.is_read ? (
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => void markRead(a.id)}>
                    علامت خوانده‌شده
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
      {open ? (
        <NewAnnouncementModal
          options={options}
          onClose={() => {
            setOpen(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function NewAnnouncementModal({ options, onClose }: { options: Options | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<'all' | 'class' | 'role'>('all');
  const [targetClassId, setTargetClassId] = useState('');
  const [targetRole, setTargetRole] = useState('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/announcements', {
        method: 'POST',
        body: {
          title,
          body,
          audience,
          targetClassId: audience === 'class' ? targetClassId : null,
          targetRole: audience === 'role' ? targetRole : null,
          publish: true,
        },
      });
      toast('اطلاعیه منتشر شد', 'success');
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
      title="اطلاعیه جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || title.length < 2 || body.length < 2}>
            {busy ? 'در حال انتشار…' : 'انتشار'}
          </Button>
          <Button onClick={onClose}>انصراف</Button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="عنوان" htmlFor="t">
        <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="متن" htmlFor="b">
        <Textarea id="b" value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <Field label="مخاطب" htmlFor="a">
        <Select id="a" value={audience} onChange={(e) => setAudience(e.target.value as 'all' | 'class' | 'role')}>
          <option value="all">همه کاربران مدرسه</option>
          <option value="role">یک نقش مشخص</option>
          <option value="class">یک کلاس مشخص</option>
        </Select>
      </Field>
      {audience === 'class' ? (
        <Field label="کلاس" htmlFor="c">
          <Select id="c" value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)}>
            <option value="">— انتخاب —</option>
            {options?.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {audience === 'role' ? (
        <Field label="نقش" htmlFor="r">
          <Select id="r" value={targetRole} onChange={(e) => setTargetRole(e.target.value)}>
            <option value="student">دانش‌آموز</option>
            <option value="guardian">ولی</option>
            <option value="teacher">دبیر</option>
          </Select>
        </Field>
      ) : null}
      <Alert tone="warning">در اطلاعیه‌های عمومی، اطلاعات شخصی دانش‌آموزان را درج نکنید.</Alert>
    </Modal>
  );
}

export function NotificationsPage() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: Notification[]; unread: number }>('/notifications');
      setItems(res.items);
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
        title="اعلان‌ها"
        subtitle="اعلان‌ها فقط برای گیرندگان مجاز ساخته می‌شوند."
        actions={
          <Button
            size="sm"
            onClick={async () => {
              await api('/notifications/read-all', { method: 'POST' });
              await load();
            }}
          >
            خواندن همه
          </Button>
        }
      />
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Card>
        {!items ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyState title="اعلانی وجود ندارد" />
        ) : (
          <div className="grid" style={{ gap: 10 }}>
            {items.map((n) => (
              <div key={n.id} className="card tight">
                <div className="row between">
                  <strong>{n.title}</strong>
                  {!n.read_at ? <Badge tone="primary">خوانده‌نشده</Badge> : <Badge>خوانده‌شده</Badge>}
                </div>
                {n.body ? <p className="small mt-2 mb-0">{n.body}</p> : null}
                <div className="hint">{formatDateTime(n.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
