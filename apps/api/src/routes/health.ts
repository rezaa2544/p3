import type { FastifyInstance } from 'fastify';
import { globalQuery, getPool, q } from '../db.js';
import { requirePerm } from '../lib/http.js';

const startedAt = Date.now();

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async (_req, reply) => {
    let dbOk = false;
    let migrations = 0;
    try {
      const rows = await globalQuery<{ n: number }>('select count(*)::int as n from schema_migrations');
      migrations = rows[0]?.n ?? 0;
      dbOk = migrations > 0;
    } catch {
      dbOk = false;
    }
    const status = dbOk ? 'ok' : 'degraded';
    reply.status(dbOk ? 200 : 503);
    return {
      status,
      service: 'payesh2-api',
      version: process.env.APP_VERSION ?? '0.1.0',
      db: dbOk ? 'ok' : 'unavailable',
      migrations,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
    };
  });

  app.get('/health/deep', async (req) => {
    requirePerm(req, 'system.health');
    const counts = await q<{ students: number; classes: number; users: number; attendance_today: number }>(
      `select
         (select count(*)::int from students where school_id = current_setting('app.school_id')::uuid) as students,
         (select count(*)::int from classes where school_id = current_setting('app.school_id')::uuid) as classes,
         (select count(*)::int from memberships where school_id = current_setting('app.school_id')::uuid) as users,
         (select count(*)::int from attendance_records where school_id = current_setting('app.school_id')::uuid
            and day = (now() at time zone 'Asia/Tehran')::date) as attendance_today`,
    );
    const pool = getPool();
    return {
      status: 'ok',
      counts: counts[0] ?? null,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      time: new Date().toISOString(),
    };
  });
}
