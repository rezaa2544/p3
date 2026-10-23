import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api.js';
import { formatDateTime, roleLabel } from '../lib/format.js';
import { clearAllLocalData } from '../lib/offline.js';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, toast } from '../components/ui.js';
import { useAuth } from '../state/auth.js';

export function SettingsPage() {
  const { me, logout, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<{ id: string; ip: string; user_agent: string; created_at: string; revoked_at: string | null }[]>([]);
  const [mfa, setMfa] = useState<{ secret: string; uri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  useEffect(() => {
    api<{ items: typeof sessions }>('/auth/sessions')
      .then((r) => setSessions(r.items))
      .catch(() => undefined);
  }, []);

  const changePassword = async () => {
    setError(null);
    if (newPassword !== repeat) {
      setError('تکرار رمز جدید مطابقت ندارد');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('رمز عبور تغییر کرد؛ سایر نشست‌ها باطل شدند', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setRepeat('');
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const startMfa = async () => {
    try {
      setMfa(await api<{ secret: string; uri: string }>('/auth/mfa/enroll', { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const confirmMfa = async () => {
    try {
      await api('/auth/mfa/confirm', { method: 'POST', body: { code: mfaCode } });
      toast('تأیید دو‌مرحله‌ای فعال شد', 'success');
      setMfa(null);
      setMfaCode('');
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const revoke = async (id: string) => {
    try {
      await api(`/auth/sessions/${id}`, { method: 'DELETE' });
      setSessions((s) => s.map((x) => (x.id === id ? { ...x, revoked_at: new Date().toISOString() } : x)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="تنظیمات حساب" subtitle={`${me?.user.fullName} — ${roleLabel(me?.role)}`} />
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid cols-2">
        <Card>
          <h2>تغییر رمز عبور</h2>
          <Field label="رمز فعلی" htmlFor="cp">
            <Input id="cp" type="password" dir="ltr" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
          <Field label="رمز جدید" htmlFor="np" hint="حداقل ۱۰ کاراکتر شامل حرف و رقم">
            <Input id="np" type="password" dir="ltr" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <Field label="تکرار رمز جدید" htmlFor="rp">
            <Input id="rp" type="password" dir="ltr" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={() => void changePassword()} disabled={busy || !currentPassword || newPassword.length < 10}>
            ذخیره
          </Button>
        </Card>

        <Card>
          <h2>تأیید دو‌مرحله‌ای (MFA)</h2>
          <p className="small soft">
            برای نقش‌های مدیریتی و دسترسی به داده حساس توصیه می‌شود. کد ۶ رقمی با برنامه احراز هویت تولید می‌شود.
          </p>
          {me?.user.mfaEnabled ? (
            <Badge tone="success">فعال است</Badge>
          ) : mfa ? (
            <>
              <Field label="کلید مخفی (در برنامه احراز هویت ثبت کنید)" htmlFor="sec">
                <Input id="sec" dir="ltr" readOnly value={mfa.secret} />
              </Field>
              <p className="hint" dir="ltr" style={{ wordBreak: 'break-all' }}>
                {mfa.uri}
              </p>
              <Field label="کد ۶ رقمی" htmlFor="mc">
                <Input id="mc" dir="ltr" inputMode="numeric" value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <Button size="sm" variant="primary" onClick={() => void confirmMfa()} disabled={mfaCode.length !== 6}>
                تأیید و فعال‌سازی
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void startMfa()}>
              فعال‌سازی MFA
            </Button>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h2>نشست‌های فعال</h2>
        {sessions.length === 0 ? (
          <p className="small muted">نشستی یافت نشد.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>زمان ایجاد</th>
                  <th>IP</th>
                  <th>مرورگر</th>
                  <th>وضعیت</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td dir="ltr">{s.ip ?? '—'}</td>
                    <td className="small" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.user_agent || '—'}
                    </td>
                    <td>{s.revoked_at ? <Badge>باطل‌شده</Badge> : <Badge tone="success">فعال</Badge>}</td>
                    <td>
                      {!s.revoked_at ? (
                        <Button size="sm" variant="danger" onClick={() => void revoke(s.id)}>
                          لغو
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4">
        <h2>داده‌های محلی این دستگاه</h2>
        <p className="small soft">
          در دستگاه‌های مشترک، پس از خروج یا پایان کار داده‌های محلی (صف همگام‌سازی، فهرست‌های کش‌شده و کش PWA) را پاک کنید.
        </p>
        <div className="row">
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await clearAllLocalData();
              toast('داده‌های محلی پاک شد', 'success');
            }}
          >
            پاک‌سازی داده‌های محلی
          </Button>
          <Button size="sm" onClick={() => void logout()}>
            خروج و پاک‌سازی
          </Button>
        </div>
      </Card>

      <p className="hint mt-4">نسخه سامانه: ۰.۱.۰ — ساخته‌شده برای سامانه مدیریت مدرسه پایش ۲</p>
    </>
  );
}
