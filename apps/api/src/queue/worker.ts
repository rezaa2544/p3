import { globalQuery } from '../db.js';

type Job = { id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };

const ATTENDANCE_LABEL: Record<string, string> = { absent: 'غیبت', late: 'تأخیر', early_leave: 'خروج زودهنگام' };

async function notifyGuardiansAttendance(payload: Record<string, unknown>): Promise<void> {
  const schoolId = String(payload.schoolId);
  const day = String(payload.day);
  const students = (payload.students as string[] | undefined) ?? [];
  if (!students.length) return;
  const rows = await globalQuery<{
    student_id: string;
    guardian_user_id: string;
    first_name: string;
    last_name: string;
    status: string;
    can_view_attendance: boolean;
  }>(
    `select g.student_id, g.guardian_user_id, s.first_name, s.last_name,
            coalesce((select a.status from attendance_records a
                       where a.student_id = g.student_id and a.day = $3::date
                         and a.class_id = $4::uuid limit 1), 'absent') as status,
            g.can_view_attendance
       from student_guardians g
       join students s on s.id = g.student_id
      where g.student_id = any($1::uuid[]) and s.school_id = $2`,
    [students, schoolId, day, String(payload.classId)],
  );
  for (const row of rows) {
    if (!row.can_view_attendance) continue;
    const link = `attendance:${day}:${row.student_id}`;
    const exists = await globalQuery<{ id: string }>(
      'select id from notifications where user_id = $1 and school_id = $2 and link = $3 limit 1',
      [row.guardian_user_id, schoolId, link],
    );
    if (exists[0]) continue;
    const label = ATTENDANCE_LABEL[row.status] ?? row.status;
    await globalQuery(
      `insert into notifications (user_id, school_id, kind, title, body, link)
       values ($1,$2,'attendance',$3,$4,$5)`,
      [
        row.guardian_user_id,
        schoolId,
        `${label} — ${row.first_name} ${row.last_name}`,
        `وضعیت حضور فرزند شما در تاریخ ${day} ثبت شد.`,
        link,
      ],
    );
  }
}

const HANDLERS: Record<string, (payload: Record<string, unknown>) => Promise<void>> = {
  notify_guardians_attendance: notifyGuardiansAttendance,
};

/** پردازش یک دسته از صف. برای تست قابل فراخوانی مستقیم است. */
export async function runOnce(limit = 20): Promise<{ processed: number; failed: number }> {
  const jobs = await globalQuery<Job>(
    `update outbox_jobs set status = 'running', attempts = attempts + 1, updated_at = now()
      where id in (
        select id from outbox_jobs
         where status = 'pending' and run_after <= now()
         order by run_after for update skip locked limit $1
      )
      returning id, kind, payload, attempts, max_attempts`,
    [limit],
  );
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const handler = HANDLERS[job.kind];
      if (!handler) throw new Error(`نوع کار ناشناخته: ${job.kind}`);
      await handler(job.payload);
      await globalQuery("update outbox_jobs set status = 'done', updated_at = now() where id = $1", [job.id]);
      processed++;
    } catch (e) {
      failed++;
      const terminal = job.attempts >= job.max_attempts;
      await globalQuery(
        `update outbox_jobs set status = $1, last_error = $2, updated_at = now(),
                run_after = now() + ($3 || ' minutes')::interval where id = $4`,
        [terminal ? 'failed' : 'pending', (e as Error).message.slice(0, 500), String(job.attempts * job.attempts), job.id],
      );
    }
  }
  return { processed, failed };
}

export function startWorker(intervalMs = 15_000): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', msg: 'queue worker error', error: (e as Error).message }));
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
