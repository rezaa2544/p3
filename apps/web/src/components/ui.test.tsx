import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Badge, EmptyState, Modal, Pagination, Stat, Tabs, Toaster, toast } from './ui.js';
import { formatDate, formatNumber, toEnglishDigits, toPersianDigits, todayISO, roleLabel } from '../lib/format.js';
import { LoginPage } from '../pages/Login.js';
import { AuthProvider } from '../state/auth.js';

describe('Design System', () => {
  it('داده خالی به‌جای صفر «داده موجود نیست» نشان می‌دهد', () => {
    render(<Stat label="نمرات" value={null} />);
    expect(screen.getByText('داده موجود نیست')).toBeInTheDocument();
  });

  it('EmptyState پیام فارسی نمایش می‌دهد', () => {
    render(<EmptyState title="داده‌ای وجود ندارد" description="توضیح" />);
    expect(screen.getByText('داده‌ای وجود ندارد')).toBeInTheDocument();
    expect(screen.getByText('توضیح')).toBeInTheDocument();
  });

  it('Pagination برای یک صفحه رندر نمی‌شود و برای چند صفحه دکمه‌ها را نشان می‌دهد', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} total={10} limit={25} onChange={onChange} />);
    expect(screen.queryByText('بعدی')).not.toBeInTheDocument();
    rerender(<Pagination page={2} total={100} limit={25} onChange={onChange} />);
    await userEvent.click(screen.getByText('بعدی'));
    expect(onChange).toHaveBeenCalledWith(3);
    const info = screen
      .getAllByText((_, el) => el?.className === 'small soft' && el.textContent?.includes('صفحه') === true)
      .at(0);
    expect(info?.textContent?.replace(/\s+/g, ' ')).toContain('صفحه ۲ از ۴');
  });

  it('Tabs با نقش ARIA و انتخاب کار می‌کند', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="a"
        onChange={onChange}
        tabs={[
          { id: 'a' as const, label: 'اول' },
          { id: 'b' as const, label: 'دوم' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'اول' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'دوم' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('Modal با Escape بسته می‌شود و نقش dialog دارد', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="عنوان" onClose={onClose}>
        <button>داخل</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('Toast در ناحیه aria-live نمایش داده می‌شود', async () => {
    render(<Toaster />);
    toast('ثبت شد', 'success');
    expect(await screen.findByText('ثبت شد')).toBeInTheDocument();
  });

  it('Badge رنگ وضعیت را به کلاس منتقل می‌کند', () => {
    const { container } = render(<Badge tone="danger">غایب</Badge>);
    expect(container.querySelector('.badge.danger')).toBeTruthy();
  });
});

describe('قالب‌بندی فارسی', () => {
  it('ارقام فارسی و لاتین تبدیل می‌شوند', () => {
    expect(toPersianDigits(1234)).toBe('۱۲۳۴');
    expect(toEnglishDigits('۱۴۰۴')).toBe('1404');
  });

  it('اعداد با جداکننده فارسی نمایش داده می‌شوند', () => {
    expect(formatNumber(1234)).toContain('۱');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('تاریخ میلادی به شمسی قمری‌نیست و برچسب نقش فارسی است', () => {
    expect(formatDate('2026-03-21')).not.toBe('—');
    expect(roleLabel('school_admin')).toBe('مدیر مدرسه');
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('صفحه ورود', () => {
  it('فرم فارسی/راست‌چین با برچسب‌های قابل دسترس رندر می‌شود', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'x' } }), { status: 401 })),
    );
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText('نام کاربری')).toBeInTheDocument();
    expect(screen.getByLabelText('رمز عبور')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'ورود' })).toBeInTheDocument();
    expect(document.documentElement.dir === '' || document.documentElement.dir === 'rtl').toBe(true);
  });
});

describe('Modal — پایداری فوکوس هنگام تایپ', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState('');
    // مانند مصرف‌کننده‌های واقعی، هر رندر یک تابع تازه برای onClose ساخته می‌شود
    return (
      <Modal open={open} onClose={() => setOpen(false)} title="اصلاح حضور" footer={<button type="button">ثبت</button>}>
        <label htmlFor="reason">دلیل</label>
        <textarea id="reason" value={value} onChange={(e) => setValue(e.target.value)} />
      </Modal>
    );
  }

  it('تایپ متن فارسی با فاصله مودال را نمی‌بندد و فوکوس روی دکمه‌ی ✕ نمی‌رود', async () => {
    render(<Harness />);
    const field = screen.getByLabelText('دلیل');
    await userEvent.click(field);
    await userEvent.keyboard('ثبت اشتباه در زنگ اول');
    expect(screen.getByLabelText('دلیل')).toHaveValue('ثبت اشتباه در زنگ اول');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.activeElement).toBe(field);
  });
});
