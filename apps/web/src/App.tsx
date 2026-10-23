import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { Loading } from './components/ui.js';
import { LoginPage } from './pages/Login.js';
import { DashboardPage } from './pages/Dashboard.js';
import { AuthProvider, useAuth } from './state/auth.js';

const AttendancePage = lazy(() => import('./pages/Attendance.js').then((m) => ({ default: m.AttendancePage })));
const AttendanceReportPage = lazy(() => import('./pages/AttendanceReport.js').then((m) => ({ default: m.AttendanceReportPage })));
const GradesPage = lazy(() => import('./pages/Grades.js').then((m) => ({ default: m.GradesPage })));
const ReportCardPage = lazy(() => import('./pages/ReportCard.js').then((m) => ({ default: m.ReportCardPage })));
const StudentsPage = lazy(() => import('./pages/Students.js').then((m) => ({ default: m.StudentsPage })));
const UsersPage = lazy(() => import('./pages/Users.js').then((m) => ({ default: m.UsersPage })));
const AssignmentsPage = lazy(() => import('./pages/Assignments.js').then((m) => ({ default: m.AssignmentsPage })));
const AnnouncementsPage = lazy(() => import('./pages/Announcements.js').then((m) => ({ default: m.AnnouncementsPage })));
const NotificationsPage = lazy(() => import('./pages/Announcements.js').then((m) => ({ default: m.NotificationsPage })));
const ReportsPage = lazy(() => import('./pages/Reports.js').then((m) => ({ default: m.ReportsPage })));
const SchoolPage = lazy(() => import('./pages/School.js').then((m) => ({ default: m.SchoolPage })));
const AuditPage = lazy(() => import('./pages/Audit.js').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/Settings.js').then((m) => ({ default: m.SettingsPage })));

function Protected({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { me, loading, has } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="بررسی دسترسی…" />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (permission && !has(permission)) {
    return (
      <div className="card">
        <h2>دسترسی مجاز نیست</h2>
        <p className="soft mb-0">نقش شما اجازه دسترسی به این بخش را ندارد. در صورت نیاز با مدیر مدرسه تماس بگیرید.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { loading, me } = useAuth();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <Loading label="در حال آماده‌سازی پایش ۲…" />
      </div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            me ? (
              <Layout />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        >
          <Route index element={<Protected><DashboardPage /></Protected>} />
          <Route path="/attendance" element={<Protected permission="attendance.write"><AttendancePage /></Protected>} />
          <Route path="/attendance/report" element={<Protected permission="attendance.read"><AttendanceReportPage /></Protected>} />
          <Route path="/grades" element={<Protected permission="grades.read"><GradesPage /></Protected>} />
          <Route path="/report-card" element={<Protected permission="grades.read"><ReportCardPage /></Protected>} />
          <Route path="/assignments" element={<Protected permission="assignments.read"><AssignmentsPage /></Protected>} />
          <Route path="/announcements" element={<Protected permission="comms.read"><AnnouncementsPage /></Protected>} />
          <Route path="/notifications" element={<Protected permission="comms.read"><NotificationsPage /></Protected>} />
          <Route path="/students" element={<Protected permission="students.read"><StudentsPage /></Protected>} />
          <Route path="/users" element={<Protected permission="users.read"><UsersPage /></Protected>} />
          <Route path="/reports" element={<Protected permission="reports.read"><ReportsPage /></Protected>} />
          <Route path="/school" element={<Protected permission="school.read"><SchoolPage /></Protected>} />
          <Route path="/audit" element={<Protected permission="audit.read"><AuditPage /></Protected>} />
          <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
          <Route
            path="*"
            element={
              <div className="card">
                <h2>صفحه یافت نشد</h2>
                <p className="soft mb-0">نشانی وارد شده در سامانه وجود ندارد.</p>
              </div>
            }
          />
        </Route>
      </Routes>
    </Suspense>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
