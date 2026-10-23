import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StandaloneGuide } from './StandaloneGuide.js';

describe('راهنمای نسخه تک‌فایل (file://)', () => {
  it('به‌جای فرم ورود، توضیح می‌دهد که با file:// به API دسترسی نیست', () => {
    render(<StandaloneGuide />);
    expect(screen.getByText(/باز شده است/)).toBeInTheDocument();
    expect(document.querySelector('input[type=password]')).toBeNull();
    expect(screen.getByLabelText('نشانی سرور')).toBeInTheDocument();
  });

  it('مسیر درست (باز کردن از سرور) را نشان می‌دهد', () => {
    render(<StandaloneGuide />);
    expect(screen.getByText('http://localhost:3000/standalone.html')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /رفتن به برنامه روی سرور/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /باز کردن این فایل از سرور/ })).toBeInTheDocument();
  });

  it('نشانی سرور قابل تغییر است و به همان آدرس هدایت می‌شود', async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });
    try {
      render(<StandaloneGuide />);
      const input = screen.getByLabelText('نشانی سرور');
      await userEvent.clear(input);
      await userEvent.type(input, 'http://192.168.1.20:3000/');
      await userEvent.click(screen.getByRole('button', { name: /رفتن به برنامه روی سرور/ }));
      expect(assign).toHaveBeenCalledWith('http://192.168.1.20:3000/');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
