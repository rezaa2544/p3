import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === '1' || v.toLowerCase() === 'true'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional(),
  DEV_PGLITE: bool(true),
  PGLITE_DIR: z.string().default('.pglite'),
  PGLITE_PORT: z.coerce.number().int().default(55432),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me-000000000000'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  COOKIE_SECURE: bool(false),
  UPLOAD_DIR: z.string().default('.data/uploads'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  TRUST_PROXY: bool(true),
  SEED_DEMO: bool(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

export type Config = z.infer<typeof schema> & { isProd: boolean };

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`پیکربندی نامعتبر است: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  const cfg = parsed.data;
  const isProd = cfg.NODE_ENV === 'production';
  if (isProd) {
    if (cfg.SESSION_SECRET.startsWith('dev-only') || cfg.SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET در محیط تولید باید حداقل ۳۲ کاراکتر و غیرپیش‌فرض باشد');
    }
    if (!cfg.COOKIE_SECURE) {
      throw new Error('COOKIE_SECURE باید در محیط تولید فعال باشد');
    }
    if (cfg.SEED_DEMO) {
      throw new Error('SEED_DEMO در محیط تولید مجاز نیست');
    }
  }
  return { ...cfg, isProd };
}

export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
