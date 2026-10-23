import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api.js';
import { ATTENDANCE_LABELS, formatDate, formatDateTime, formatNumber, fullName, statusBadgeClass } from '../lib/format.js';
import type { Dashboard, DashboardAdmin, DashboardGuardian, DashboardStudent, DashboardTeacher } from '../lib/types.js';
import { Alert, Badge, Card, EmptyState, Loading, PageHeader, Stat } from '../components/ui.js';

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Dashboard>('/dashboard')
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Loading />;

  return (
    <>
      <PageHeader title="داشبورد" subtitle={`امروز ${formatDate(data.role === 'teacher' ? (data as DashboardTeacher).date : new Date())}`} />
      {data.role === 'teacher' ? <TeacherDashboard data={data as DashboardTeacher} /> : null}
      {data.role === 'student' ? <StudentDashboard data={data as DashboardStudent} /> : null}
      {data.role === 'guardian' ? <GuardianDashboard data={data as DashboardGuardian} /> : null}
      {!['teacher', 'student', 'guardian'].includes(data.role) ? <AdminDashboard data={data as DashboardAdmin} /> : null}
    </>
  );
}

function AdminDashboard({ data }: { data: DashboardAdmin }) {
  const s = data.stats;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-4">
        <Stat label="دانش‌آموزان" value={formatNumber(s.students)} hint={`${formatNumber(s.active_students)} فعال`} />
        <Stat label="کلاس‌های فعال" value={formatNumber(s.classes)} />
        <Stat label="دبیران" value={formatNumber(s.teachers)} hint={`${formatNumber(s.staff)} کارمند`} />
        <Stat
          label="ثبت حضور امروز"
          value={s.hasAttendanceDataToday ? formatNumber(s.attendanceRecordedToday) : null}
          hint={s.hasAttendanceDataToday ? `${formatNumber(s.absentStudentsToday)} دانش‌آموز غایب` : 'هنوز ثبت نشده'}
        />
      </div>

      <div className="grid cols-2">
        <Card>
          <div className="card-head">
            <h2>وضعیت حضور امروز</h2>
            <Link to="/attendance/report" className="small">
              گزارش کامل
            </Link>
          </div>
          {s.hasAttendanceDataToday ? (
            <div className="row">
              {s.attendanceByStatus.map((row) => (
                <Badge key={row.status} tone={statusBadgeClass(row.status)}>
                  {ATTENDANCE_LABELS[row.status] ?? row.status}: {formatNumber(row.count)}
                </Badge>
              ))}
            </div>
          ) : (
            <EmptyState title="داده حضور امروز موجود نیست" description="پس از ثبت حضور توسط دبیران، آمار این بخش نمایش داده می‌شود." />
          )}
          <div className="divider" />
          <h3>کلاس‌های بدون ثبت حضور</h3>
          {data.classesWithoutAttendanceToday.length === 0 ? (
            <p className="small soft mb-0">همه کلاس‌ها امروز ثبت شده‌اند.</p>
          ) : (
            <div className="row">
              {data.classesWithoutAttendanceToday.map((c) => (
                <Badge key={c.id} tone="warning">
                  {c.title}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="card-head">
            <h2>اقدام‌های لازم</h2>
          </div>
          <div className="grid" style={{ gap: 10 }}>
            <Stat label="نمرات در انتظار تأیید" value={formatNumber(s.gradesPendingApproval)} />
            <Link to="/grades" className="btn sm">
              بررسی نمرات
            </Link>
            <Link to="/students" className="btn sm">
              مدیریت دانش‌آموزان
            </Link>
            <Link to="/reports" className="btn sm">
              گزارش‌های مدیریتی
            </Link>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-head">
          <h2>آخرین رویدادها</h2>
          <Link to="/audit" className="small">
            همه رویدادها
          </Link>
        </div>
        {data.recentActivity.length === 0 ? (
          <EmptyState title="رویدادی ثبت نشده است" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>کاربر</th>
                  <th>عملیات</th>
                  <th>موجودیت</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActivity.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>{a.actor_name ?? '—'}</td>
                    <td dir="ltr">{a.action}</td>
                    <td dir="ltr">{a.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TeacherDashboard({ data }: { data: DashboardTeacher }) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-3">
        <Stat label="کلاس‌های امروز" value={formatNumber(data.classesToday.length)} />
        <Stat label="کلاس‌های بدون ثبت حضور" value={formatNumber(data.pendingAttendanceCount)} />
        <Stat label="ارزیابی‌های پیش‌نویس" value={formatNumber(data.draftAssessments)} />
      </div>
      <div className="grid cols-2">
        <Card>
          <div className="card-head">
            <h2>ثبت حضور در انتظار</h2>
            <Link to="/attendance" className="small">
              رفتن به ثبت حضور
            </Link>
          </div>
          {data.pendingAttendance.length === 0 ? (
            <EmptyState title="همه کلاس‌های امروز ثبت شده‌اند" description="اگر کلاسی امروز تشکیل نشده، نیازی به ثبت نیست." />
          ) : (
            <div className="row">
              {data.pendingAttendance.map((c) => (
                <Link key={`${c.class_id}-${c.period_no}`} to={`/attendance?classId=${c.class_id}`} className="badge warning">
                  {c.class_title} — زنگ {formatNumber(c.period_no)}
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <div className="card-head">
            <h2>تکالیف پیش‌رو</h2>
          </div>
          {data.upcomingAssignments.length === 0 ? (
            <EmptyState title="تکلیف فعالی ندارید" />
          ) : (
            <ul className="small" style={{ paddingInlineStart: 18, margin: 0 }}>
              {data.upcomingAssignments.map((a) => (
                <li key={a.id}>
                  {a.title} — {a.class_title} — مهلت {formatDateTime(a.due_at)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card>
        <div className="card-head">
          <h2>برنامه امروز</h2>
        </div>
        {data.classesToday.length === 0 ? (
          <EmptyState title="برنامه‌ای برای امروز ثبت نشده است" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>زنگ</th>
                  <th>کلاس</th>
                  <th>درس</th>
                </tr>
              </thead>
              <tbody>
                {data.classesToday.map((c, i) => (
                  <tr key={`${c.class_id}-${i}`}>
                    <td>{c.period_no ? formatNumber(c.period_no) : '—'}</td>
                    <td>{c.class_title}</td>
                    <td>{c.subject_title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function StudentDashboard({ data }: { data: DashboardStudent }) {
  if (!data.enrolled) return <Alert tone="warning">پرونده دانش‌آموزی برای این حساب ثبت نشده است. با مدیر مدرسه تماس بگیرید.</Alert>;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card>
        <div className="card-head">
          <h2>تکالیف پیش‌رو</h2>
          <Link to="/assignments" className="small">
            همه تکالیف
          </Link>
        </div>
        {data.upcomingAssignments.length === 0 ? (
          <EmptyState title="تکلیف فعالی ندارید" />
        ) : (
          <ul>
            {data.upcomingAssignments.map((a) => (
              <li key={a.id}>
                <strong>{a.title}</strong> — {a.subject_title} — مهلت {formatDateTime(a.due_at)}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid cols-2">
        <Link to="/report-card" className="card">
          <h3>کارنامه من</h3>
          <p className="small soft mb-0">مشاهده نمرات منتشرشده و میانگین دروس</p>
        </Link>
        <Link to="/notifications" className="card">
          <h3>اعلان‌ها</h3>
          <p className="small soft mb-0">{formatNumber(data.unreadNotifications ?? 0)} اعلان خوانده‌نشده</p>
        </Link>
      </div>
    </div>
  );
}

function GuardianDashboard({ data }: { data: DashboardGuardian }) {
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-2">
        {data.children.length === 0 ? (
          <Card>
            <EmptyState title="فرزندی به حساب شما متصل نیست" description="برای اتصال، با مدیر مدرسه تماس بگیرید." />
          </Card>
        ) : (
          data.children.map((child) => {
            const stats = data.attendanceLast30Days.filter((a) => a.student_id === child.id);
            return (
              <Card key={child.id}>
                <div className="card-head">
                  <h2>{fullName(child.first_name, child.last_name)}</h2>
                  <Badge>{child.class_title ?? 'بدون کلاس'}</Badge>
                </div>
                {stats.length === 0 ? (
                  <p className="small soft mb-0">داده حضور ۳۰ روز گذشته موجود نیست.</p>
                ) : (
                  <div className="row">
                    {stats.map((s) => (
                      <Badge key={s.status} tone={statusBadgeClass(s.status)}>
                        {ATTENDANCE_LABELS[s.status] ?? s.status}: {formatNumber(s.n)}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="row mt-3">
                  <Link className="btn sm" to={`/report-card?studentId=${child.id}`}>
                    کارنامه
                  </Link>
                  <Link className="btn sm" to={`/attendance/report?studentId=${child.id}`}>
                    حضور و غیاب
                  </Link>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
