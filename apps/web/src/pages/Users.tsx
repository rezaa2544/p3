import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDateTime, roleLabel } from '../lib/format.js';
import type { UserRow } from '../lib/types.js';
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

type UserList = { items: UserRow[]; total: number; page: number; limit: number };

const ROLES = [
  'school_admin',
  'vice_principal',
  'it_operator',
  'teacher',
  'counselor',
  'finance',
  'student',
  'guardian',
];

export function UsersPage() {
  const { has, me } = useAuth();
  const [data, setData] = useState<UserList | null>(null);
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password?: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '25' });
      if (role) qs.set('role', role);
      if (search.trim()) qs.set('search', search.trim());
      setData(await api<UserList>(`/users?${qs.toString()}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [page, role, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleActive = async (u: UserRow) => {
    setBusy(true);
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.is_active } });
      toast(u.is_active ? 'حساب غیرفعال و نشست‌ها باطل شد' : 'حساب فعال شد', 'success');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: UserRow) => {
    setBusy(true);
    try {
      const res = await api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' });
      setCreated({ username: u.username, password: res.temporaryPassword });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="کاربران و نقش‌ها"
        subtitle="نقش‌ها و مجوزها سمت سرور اعمال می‌شوند. حساب غیرفعال فوراً از دسترسی محروم می‌شود."
        actions={
          has('users.manage') ? (
            <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
              کاربر جدید
            </Button>
          ) : null
        }
      />
      <Card className="mb-3">
        <div className="form-row">
          <Field label="نقش" htmlFor="role">
            <Select
              id="role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setPage(1);
              }}
            >
              <option value="">همه نقش‌ها</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="جست‌وجو" htmlFor="q">
            <Input
              id="q"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="نام یا نام کاربری"
            />
          </Field>
        </div>
      </Card>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {created ? (
        <div className="mb-3">
          <Alert tone="success">
            رمز موقت برای <strong dir="ltr">{created.username}</strong>: <code dir="ltr">{created.password ?? '—'}</code> — این رمز فقط یک‌بار
            نمایش داده می‌شود و کاربر باید آن را تغییر دهد.
          </Alert>
        </div>
      ) : null}
      <Card>
        {!data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <EmptyState title="کاربری یافت نشد" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>نام کاربری</th>
                    <th>نقش</th>
                    <th>وضعیت</th>
                    <th>MFA</th>
                    <th>آخرین ورود</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    <tr key={u.id}>
                      <td>{u.full_name}</td>
                      <td dir="ltr">{u.username}</td>
                      <td>{roleLabel(u.role)}</td>
                      <td>
                        <Badge tone={u.is_active ? 'success' : 'danger'}>{u.is_active ? 'فعال' : 'غیرفعال'}</Badge>
                        {u.must_change_password ? <Badge tone="warning">رمز موقت</Badge> : null}
                      </td>
                      <td>{u.mfa_enabled ? <Badge tone="success">فعال</Badge> : <span className="muted">—</span>}</td>
                      <td>{u.last_login_at ? formatDateTime(u.last_login_at) : 'بدون ورود'}</td>
                      <td>
                        {has('users.manage') && u.id !== me?.user.id ? (
                          <div className="row">
                            <Button size="sm" onClick={() => void toggleActive(u)} disabled={busy}>
                              {u.is_active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void resetPassword(u)} disabled={busy}>
                              بازنشانی رمز
                            </Button>
                          </div>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} total={data.total} limit={data.limit} onChange={setPage} />
          </>
        )}
      </Card>
      {createOpen ? (
        <CreateUserModal
          onClose={() => {
            setCreateOpen(false);
            void load();
          }}
          onCreated={(info) => setCreated(info)}
        />
      ) : null}
    </>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (i: { username: string; password?: string }) => void }) {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('teacher');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ username: string; temporaryPassword?: string }>('/users', {
        method: 'POST',
        body: { username, fullName, role },
      });
      onCreated({ username: res.username, password: res.temporaryPassword });
      toast('کاربر ایجاد شد', 'success');
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
      title="کاربر جدید"
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || username.length < 3 || fullName.length < 2}>
            {busy ? 'در حال ذخیره…' : 'ایجاد'}
          </Button>
          <Button onClick={onClose}>انصراف</Button>
        </>
      }
    >
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Field label="نام کاربری" htmlFor="un" hint="حروف لاتین، رقم و . _ -">
        <Input id="un" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="نام و نام خانوادگی" htmlFor="fn">
        <Input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label="نقش" htmlFor="r" hint="فقط نقش‌هایی که مجاز به تخصیص آن‌ها هستید نمایش داده می‌شود">
        <Select id="r" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
