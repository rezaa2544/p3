import { toPersianDigits } from '../lib/format.js';
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="card-head">
        <h2>{title}</h2>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {children}
    </Card>
  );
}

export function Button({
  children,
  variant = 'default',
  size,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; size?: 'sm' }) {
  return (
    <button className={`btn ${variant !== 'default' ? variant : ''} ${size === 'sm' ? 'sm' : ''} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <span className="error-text">{error}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success' | 'warning'; children: ReactNode }) {
  return (
    <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{tone === 'error' ? '⚠️' : tone === 'success' ? '✅' : tone === 'warning' ? '⏳' : 'ℹ️'}</span>
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden="true">📭</div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {description ? <div className="small">{description}</div> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Loading({ label = 'در حال بارگذاری…' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 16, justifyContent: 'center', color: 'var(--c-text-soft)' }}>
      <span className="spinner" aria-hidden="true" />
      <span role="status">{label}</span>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="card tight">
      <div className="stat">
        <span className="label">{label}</span>
        <span className={`value ${empty ? 'na' : ''}`}>{empty ? 'داده موجود نیست' : value}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  total,
  limit,
  onChange,
}: {
  page: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="pagination no-print">
      <Button size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1}>
        قبلی
      </Button>
      <span className="small soft">
        صفحه {toPersianDigits(page)} از {toPersianDigits(pages)} — {toPersianDigits(total)} رکورد
      </span>
      <Button size="sm" onClick={() => onChange(page + 1)} disabled={page >= pages}>
        بعدی
      </Button>
    </div>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <div className="card-head">
          <h2 id="modal-title">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="بستن">
            ✕
          </Button>
        </div>
        {children}
        {footer ? <div className="row mt-3">{footer}</div> : null}
      </div>
    </div>
  );
}

type Toast = { id: number; message: string; tone: 'success' | 'error' | 'default' };
let toastId = 0;
const toastListeners = new Set<(toasts: Toast[]) => void>();
let toasts: Toast[] = [];

function emit(): void {
  for (const l of toastListeners) l([...toasts]);
}

export function toast(message: string, tone: Toast['tone'] = 'default'): void {
  const item = { id: ++toastId, message, tone };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emit();
  }, 4000);
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>(toasts);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => {
      toastListeners.delete(setItems);
    };
  }, []);
  return (
    <div className="toast-host" aria-live="polite" aria-atomic="true">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} type="button">
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row no-print">{actions}</div> : null}
    </div>
  );
}
