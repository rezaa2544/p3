import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ApiError, NetworkError, api, isOffline } from './api.js';

export type QueueStatus = 'pending' | 'sending' | 'synced' | 'conflict' | 'failed' | 'needs_auth';

export type QueuedOperation = {
  id: string;
  kind: 'attendance';
  endpoint: string;
  method: 'POST';
  payload: unknown;
  label: string;
  status: QueueStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  error: string | null;
  details: unknown;
  serverIds: string[] | null;
};

export type RosterStudent = { id: string; first_name: string; last_name: string; class_title?: string | null };
export type CachedRoster = { classId: string; className: string; students: RosterStudent[]; savedAt: string };

interface PayeshDB extends DBSchema {
  queue: { key: string; value: QueuedOperation; indexes: { 'by-status': string } };
  rosters: { key: string; value: CachedRoster };
}

let dbPromise: Promise<IDBPDatabase<PayeshDB>> | null = null;

function db(): Promise<IDBPDatabase<PayeshDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PayeshDB>('payesh2', 1, {
      upgrade(database) {
        const queue = database.createObjectStore('queue', { keyPath: 'id' });
        queue.createIndex('by-status', 'status');
        database.createObjectStore('rosters', { keyPath: 'classId' });
      },
    });
  }
  return dbPromise;
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

export function newOperationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueAttendance(input: {
  classId: string;
  className: string;
  day: string;
  periodNo: number;
  records: { studentId: string; status: string; note?: string | null }[];
}): Promise<QueuedOperation> {
  const now = new Date().toISOString();
  const op: QueuedOperation = {
    id: newOperationId(),
    kind: 'attendance',
    endpoint: '/attendance',
    method: 'POST',
    payload: {
      classId: input.classId,
      day: input.day,
      periodNo: input.periodNo,
      source: 'offline',
      capturedAt: now,
      records: input.records,
    },
    label: `حضور ${input.className} — ${input.day}`,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    nextAttemptAt: null,
    error: null,
    details: null,
    serverIds: null,
  };
  const database = await db();
  await database.put('queue', op);
  notify();
  return op;
}

export async function listQueue(): Promise<QueuedOperation[]> {
  const database = await db();
  const all = await database.getAll('queue');
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function queueSummary(): Promise<{ pending: number; conflict: number; failed: number; needsAuth: number; synced: number }> {
  const all = await listQueue();
  return {
    pending: all.filter((o) => o.status === 'pending' || o.status === 'sending').length,
    conflict: all.filter((o) => o.status === 'conflict').length,
    failed: all.filter((o) => o.status === 'failed').length,
    needsAuth: all.filter((o) => o.status === 'needs_auth').length,
    synced: all.filter((o) => o.status === 'synced').length,
  };
}

export async function updateOperation(id: string, patch: Partial<QueuedOperation>): Promise<void> {
  const database = await db();
  const current = await database.get('queue', id);
  if (!current) return;
  await database.put('queue', { ...current, ...patch, updatedAt: new Date().toISOString() });
  notify();
}

export async function discardOperation(id: string): Promise<void> {
  const database = await db();
  await database.delete('queue', id);
  notify();
}

export type Sender = (op: QueuedOperation) => Promise<{ ids?: string[] }>;

const defaultSender: Sender = async (op) => {
  const result = await api<{ ids?: string[] }>(op.endpoint, {
    method: op.method,
    body: op.payload,
    headers: { 'idempotency-key': op.id },
  });
  return { ids: result?.ids };
};

let flushing = false;

/**
 * ارسال صف به سرور. تا وقتی سرور تأیید نکند وضعیت «تأییدشده» نمی‌شود.
 * - خطای شبکه یا ۵xx: عملیات در صف می‌ماند و با تأخیر دوباره تلاش می‌شود
 * - 409: تعارض برای بررسی کاربر
 * - 401: نیاز به ورود مجدد (صف حفظ می‌شود)
 * - سایر ۴xx: ناموفق با پیام قابل فهم
 */
export async function flushQueue(sender: Sender = defaultSender): Promise<{ sent: number; conflicts: number; errors: number }> {
  if (flushing) return { sent: 0, conflicts: 0, errors: 0 };
  if (isOffline()) return { sent: 0, conflicts: 0, errors: 0 };
  flushing = true;
  let sent = 0;
  let conflicts = 0;
  let errors = 0;
  try {
    const ops = (await listQueue()).filter((o) => o.status === 'pending' || o.status === 'sending');
    for (const op of ops) {
      if (op.nextAttemptAt && new Date(op.nextAttemptAt).getTime() > Date.now()) continue;
      await updateOperation(op.id, { status: 'sending' });
      try {
        const result = await sender(op);
        await updateOperation(op.id, {
          status: 'synced',
          serverIds: result.ids ?? null,
          error: null,
          details: null,
          nextAttemptAt: null,
        });
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await updateOperation(op.id, { status: 'needs_auth', error: 'نشست منقضی شده است؛ دوباره وارد شوید' });
          break;
        }
        if (e instanceof ApiError && e.status === 409) {
          conflicts++;
          await updateOperation(op.id, {
            status: 'conflict',
            error: e.message,
            details: e.details ?? null,
            nextAttemptAt: null,
          });
          continue;
        }
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
          errors++;
          await updateOperation(op.id, { status: 'failed', error: e.message, details: e.details ?? null });
          continue;
        }
        // خطای موقت: حفظ در صف با عقب‌نشینی
        const attempts = op.attempts + 1;
        const delayMinutes = Math.min(15, 2 ** Math.min(attempts, 4));
        await updateOperation(op.id, {
          status: 'pending',
          attempts,
          error: e instanceof NetworkError ? e.message : 'خطای موقت سرور؛ تلاش مجدد انجام می‌شود',
          nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        });
        errors++;
        break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return { sent, conflicts, errors };
}

export async function saveRoster(roster: CachedRoster): Promise<void> {
  const database = await db();
  await database.put('rosters', roster);
}

export async function getRoster(classId: string): Promise<CachedRoster | undefined> {
  const database = await db();
  return database.get('rosters', classId);
}

/** پاک‌سازی داده محلی حساس: صف، فهرست‌های کش‌شده و کش سرویس‌ورکر */
export async function clearAllLocalData(): Promise<void> {
  try {
    const database = await db();
    await database.clear('queue');
    await database.clear('rosters');
  } catch {
    /* IndexedDB ممکن است در دسترس نباشد */
  }
  if (typeof caches !== 'undefined') {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
  }
  notify();
}
