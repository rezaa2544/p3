import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { AppError } from './errors.js';
import { assertCsrf, resolveAuth } from './security/session.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSchoolRoutes } from './routes/school.js';
import { registerPeopleRoutes } from './routes/people.js';
import { registerAttendanceRoutes } from './routes/attendance.js';
import { registerGradeRoutes } from './routes/grades.js';
import { registerAssignmentRoutes } from './routes/assignments.js';
import { registerCommsRoutes } from './routes/comms.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerFileRoutes } from './routes/files.js';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const cfg = config();
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: cfg.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            base: undefined,
          },
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: cfg.NODE_ENV === 'production',
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    allowList: [],
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (req, context) => ({
      statusCode: 429,
      error: {
        code: 'RATE_LIMITED',
        message: 'تعداد درخواست بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید',
        retryAfter: context.after,
        requestId: req.id,
      },
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: cfg.MAX_UPLOAD_BYTES, files: 1, fields: 20 },
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    if (cfg.isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const anyErr = err as AppError & { code?: string; constraint?: string };
    let status = 500;
    let code = 'INTERNAL';
    let message = 'خطای داخلی سرور رخ داد';
    let details: unknown;

    if (err instanceof AppError) {
      status = err.statusCode;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (anyErr.statusCode === 429) {
      status = 429;
      code = 'RATE_LIMITED';
      message = 'تعداد درخواست بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید';
    } else if (typeof anyErr.statusCode === 'number' && anyErr.statusCode < 500) {
      status = anyErr.statusCode;
      code = anyErr.code ?? 'BAD_REQUEST';
      message = anyErr.message;
    } else if ((anyErr as { code?: string }).code === '23505') {
      status = 409;
      code = 'DUPLICATE';
      message = 'رکورد تکراری است';
    } else if ((anyErr as { code?: string }).code === '23503') {
      status = 409;
      code = 'REFERENCE_ERROR';
      message = 'ارجاع به داده‌ای که وجود ندارد یا قابل حذف نیست';
    } else if ((anyErr as { code?: string }).code === '22P02') {
      status = 400;
      code = 'INVALID_INPUT';
      message = 'شناسه یا مقدار ورودی نامعتبر است';
    } else if ((anyErr as { code?: string }).code === '23514') {
      status = 400;
      code = 'CONSTRAINT_FAILED';
      message = 'مقدار ورودی با قواعد داده سازگار نیست';
    }

    if (status >= 500) {
      req.log.error({ err, reqId: req.id }, 'unhandled error');
    } else {
      req.log.info({ code, status, url: req.url }, 'request rejected');
    }
    reply.status(status).send({ error: { code, message, details, requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'مسیر یافت نشد', requestId: req.id } });
  });

  await app.register(
    async (api) => {
      api.addHook('onRequest', async (req) => {
        await resolveAuth(req);
      });
      api.addHook('preHandler', async (req) => {
        assertCsrf(req);
      });

      registerHealthRoutes(api);
      registerAuthRoutes(api);
      registerSchoolRoutes(api);
      registerPeopleRoutes(api);
      registerAttendanceRoutes(api);
      registerGradeRoutes(api);
      registerAssignmentRoutes(api);
      registerCommsRoutes(api);
      registerReportRoutes(api);
      registerFileRoutes(api);
    },
    { prefix: '/api' },
  );

  /**
   * مسیر پوشه‌ی ساخته‌شده‌ی رابط کاربری. مسیر نسبی به cwd وابسته بود و اگر سرور از
   * ریشه‌ی مخزن اجرا می‌شد (`node apps/api/dist/server.js`) پیدا نمی‌شد و همه‌ی مسیرها
   * ۴۰۴ می‌دادند (از جمله بازکردن مستقیم /login). اکنون مسیر بر اساس محل خود فایل
   * محاسبه می‌شود و چند مسیر متعارف هم بررسی می‌شود.
   */
  const here = path.dirname(fileURLToPath(import.meta.url)); // …/apps/api/dist یا …/src
  const webDist =
    [
      process.env.WEB_DIST,
      path.resolve(here, '../../web/dist'),
      path.resolve(here, '../../../apps/web/dist'),
      path.resolve(process.cwd(), 'apps/web/dist'),
      path.resolve(process.cwd(), '../web/dist'),
    ].find((candidate) => candidate && existsSync(path.join(candidate, 'index.html'))) ??
    path.resolve(here, '../../web/dist');

  /**
   * نسخه‌ی «HTML تک‌فایل» را از خود سرور سرو می‌کند تا با مبدأ درست (و دسترسی به /api)
   * باز شود. باز کردن همان فایل با file:// کار نمی‌کند (مبدأ null، بدون کوکی نشست)،
   * بنابراین کاربر باید آن را از همین آدرس باز کند.
   */
  app.get('/standalone.html', async (req, reply) => {
    // اگر STANDALONE_HTML صریح تنظیم شده باشد فقط همان مسیر معتبر است (پیکربندی صریح
    // بر حدس مسیر پیشی می‌گیرد)؛ وگرنه مسیرهای متعارف مخزن/بسته بررسی می‌شوند.
    const explicit = process.env.STANDALONE_HTML;
    const candidates = explicit
      ? [explicit]
      : [
          path.resolve(here, '../../../artifacts/payesh2-standalone.html'),
          path.resolve(here, '../../../../artifacts/payesh2-standalone.html'),
          path.resolve(process.cwd(), 'artifacts/payesh2-standalone.html'),
          path.resolve(process.cwd(), 'payesh2-standalone.html'),
        ];
    const found = candidates.find((p) => existsSync(p));
    if (!found) {
      return reply.status(404).type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>پایش ۲ — نسخه تک‌فایل</title></head>
<body style="font-family:system-ui;padding:24px;line-height:2">
<h1>نسخه‌ی HTML تک‌فایل روی این سرور نیست</h1>
<p>آن را با <code>npm run artifact:html</code> بسازید یا از <a href="/">نسخه‌ی کامل برنامه</a> استفاده کنید.</p>
</body></html>`);
    }
    return reply
      .header('cache-control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(await readFile(found, 'utf8'));
  });

  if (existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    app.get('/*', async (req, reply) => {
      if (req.url.startsWith('/api')) return reply.callNotFound();
      /**
       * درخواست‌هایی که به فایل (نه مسیر صفحه) شبیه‌اند نباید index.html بگیرند؛
       * وگرنه مرورگر به‌جای ۴۰۴، فایل HTML را با MIME اشتباه به‌عنوان ماژول JS
       * بارگیری می‌کند و خطای «Expected a JavaScript module script» می‌دهد.
       */
      const pathname = req.url.split('?')[0] ?? '';
      if (pathname.startsWith('/assets/') || /\.[A-Za-z0-9]{1,16}$/.test(pathname)) return reply.callNotFound();
      return reply.sendFile('index.html', { maxAge: 0 });
    });
  } else {
    app.get('/', async (req, reply) => {
      reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>پایش ۲ — API</title></head>
<body style="font-family:system-ui;padding:24px;line-height:1.9">
<h1>پایش ۲ — سرویس API</h1>
<p>این نمونه ساخته‌شده رابط کاربری ندارد (پوشه <code>apps/web/dist</code> موجود نیست).</p>
<ul>
  <li><a href="/api/health">/api/health</a> — سلامت سرویس</li>
  <li>برای رابط کاربری: <code>npm run build</code> و سپس اجرای سرور</li>
</ul>
<p>${req.id}</p>
</body></html>`);
    });
  }

  return app;
}
