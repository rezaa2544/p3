import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth.js';
import { Alert, Button, Field, Input } from '../components/ui.js';

export function LoginPage() {
  const { me, login, loading, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (!loading && me) return <Navigate to={from} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await login(username.trim(), password, needsMfa ? mfaCode : undefined);
      if (result.mfaRequired) setNeedsMfa(true);
    } catch {
      /* پیام در context نمایش داده می‌شود */
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <img src="/icon.svg" alt="" />
          <div>
            <div className="t">پایش ۲</div>
            <div className="s">سامانه مدیریت هوشمند مدرسه</div>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div className="mt-3" />
          <Field label="نام کاربری" htmlFor="username">
            <Input
              id="username"
              name="username"
              autoComplete="username"
              dir="ltr"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="مثال: admin"
            />
          </Field>
          <Field label="رمز عبور" htmlFor="password">
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {needsMfa ? (
            <Field label="کد تأیید دو‌مرحله‌ای" htmlFor="mfa" hint="کد ۶ رقمی برنامه احراز هویت">
              <Input
                id="mfa"
                name="mfa"
                inputMode="numeric"
                pattern="\d{6}"
                dir="ltr"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
          ) : null}
          <Button type="submit" variant="primary" className="block" disabled={submitting || loading}>
            {submitting ? 'در حال ورود…' : 'ورود'}
          </Button>
        </form>
        <p className="hint mt-3 mb-0">
          دسترسی شما بر اساس نقش و مدرسه محدود می‌شود. اگر رمز خود را فراموش کرده‌اید، با مدیر مدرسه تماس بگیرید.
        </p>
      </div>
    </div>
  );
}
