import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../state/auth.js';
import { roleLabel } from '../lib/format.js';
import { SyncStatus } from './SyncStatus.js';
import { Button } from './ui.js';

type NavItem = { to: string; label: string; icon: string; permission?: string; roles?: string[] };

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'عمومی',
    items: [
      { to: '/', label: 'داشبورد', icon: '🏠' },
      { to: '/announcements', label: 'اطلاعیه‌ها', icon: '📣' },
      { to: '/notifications', label: 'اعلان‌ها', icon: '🔔' },
    ],
  },
  {
    group: 'آموزش',
    items: [
      { to: '/attendance', label: 'حضور و غیاب', icon: '🗒️', permission: 'attendance.write' },
      { to: '/attendance/report', label: 'گزارش حضور', icon: '📊', permission: 'attendance.read' },
      { to: '/grades', label: 'ارزیابی و نمرات', icon: '📝', permission: 'grades.write' },
      { to: '/report-card', label: 'کارنامه', icon: '🎓', permission: 'grades.read' },
      { to: '/assignments', label: 'تکالیف', icon: '📚' },
    ],
  },
  {
    group: 'مدیریت',
    items: [
      { to: '/students', label: 'دانش‌آموزان', icon: '👥', permission: 'students.read' },
      { to: '/users', label: 'کاربران و نقش‌ها', icon: '🧑‍💼', permission: 'users.read' },
      { to: '/reports', label: 'گزارش‌های مدیریتی', icon: '📈', permission: 'reports.read' },
      { to: '/school', label: 'مدرسه و کلاس‌ها', icon: '🏫' },
      { to: '/audit', label: 'رویدادهای حساس', icon: '🛡️', permission: 'audit.read' },
    ],
  },
  {
    group: 'حساب من',
    items: [{ to: '/settings', label: 'تنظیمات حساب', icon: '⚙️' }],
  },
];

export function Layout() {
  const { me, has, logout, switchSchool } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!me) return null;

  const visible = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.permission || has(i.permission)) && (!i.roles || i.roles.includes(me.role))),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        پرش به محتوای اصلی
      </a>
      <header className="topbar">
        <button className="btn sm menu-btn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-label="منو">
          ☰
        </button>
        <div className="brand">
          <img src="/icon.svg" alt="" />
          <span>پایش ۲</span>
        </div>
        <div className="spacer" />
        {me.memberships.length > 0 ? (
          <label className="row small" style={{ gap: 6 }}>
            <span className="soft">مدرسه:</span>
            <select
              className="select"
              style={{ minHeight: 32, padding: '2px 8px', width: 'auto' }}
              value={me.activeSchoolId}
              onChange={(e) => void switchSchool(e.target.value)}
              aria-label="انتخاب مدرسه فعال"
            >
              {me.memberships.map((m) => (
                <option key={m.schoolId} value={m.schoolId}>
                  {m.schoolName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="user-chip">
          <span className="badge primary">{roleLabel(me.role)}</span>
          <span className="small">{me.user.fullName}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void logout()}>
          خروج
        </Button>
      </header>

      <div className="shell-body">
        <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="ناوبری اصلی">
          {visible.map((group) => (
            <div key={group.group}>
              <div className="nav-group">{group.group}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={() => setMenuOpen(false)}>
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <main className="content" id="main">
          {me.user.mustChangePassword ? (
            <div className="alert warning mb-3" role="status">
              <span aria-hidden="true">🔐</span>
              <div>
                رمز عبور شما موقت است. لطفاً از <NavLink to="/settings">تنظیمات حساب</NavLink> رمز را تغییر دهید.
              </div>
            </div>
          ) : null}
          <div className="mb-3 no-print">
            <SyncStatus />
          </div>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
