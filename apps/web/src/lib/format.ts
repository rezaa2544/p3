const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function toPersianDigits(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

export function toEnglishDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export function formatNumber(value: number | string | null | undefined, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits }).format(n);
}

const dateFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Tehran',
});

const dateShortFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tehran',
});

const dateTimeFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tehran',
});

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? dateFmt.format(d) : '—';
}

export function formatDateShort(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? dateShortFmt.format(d) : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? dateTimeFmt.format(d) : '—';
}

/** تاریخ امروز به شکل YYYY-MM-DD در منطقه زمانی تهران (برای input type=date) */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function jalaliLabel(iso: string): string {
  return formatDate(iso);
}

export function relativeTime(value: string | Date | null | undefined): string {
  const d = parse(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(-diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(-diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(-diff / 3_600_000), 'hour');
  return rtf.format(Math.round(-diff / 86_400_000), 'day');
}

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غایب',
  late: 'تأخیر',
  early_leave: 'خروج زودهنگام',
  excused: 'موجه',
  sick: 'بیمار',
};

export const ROLE_LABELS: Record<string, string> = {
  org_admin: 'مدیر سازمان',
  school_admin: 'مدیر مدرسه',
  vice_principal: 'معاون',
  it_operator: 'مسئول فناوری',
  teacher: 'دبیر',
  counselor: 'مشاور',
  finance: 'مسئول مالی',
  student: 'دانش‌آموز',
  guardian: 'ولی',
};

export function roleLabel(role: string | null | undefined): string {
  return role ? (ROLE_LABELS[role] ?? role) : '';
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'present':
      return 'success';
    case 'absent':
      return 'danger';
    case 'late':
      return 'warning';
    case 'early_leave':
    case 'excused':
    case 'sick':
      return 'info';
    default:
      return '';
  }
}

export function fullName(first?: string | null, last?: string | null): string {
  return [first, last].filter(Boolean).join(' ') || '—';
}
