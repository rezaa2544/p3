import { config, loadConfig, resetConfigCache } from './config.js';
import { closePool, migrate } from './db.js';
import { buildApp } from './app.js';
import { startWorker } from './queue/worker.js';
import { ensureDatabase, stopEmbeddedDatabase } from './scripts/env.js';

async function main() {
  await ensureDatabase();
  resetConfigCache();
  const cfg = loadConfig();

  const applied = await migrate((m) => console.log(JSON.stringify({ level: 'info', msg: m })));
  if (applied.length) console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', applied }));

  const app = await buildApp();
  const stopWorker = startWorker();
  await app.listen({ port: cfg.PORT, host: cfg.HOST });
  app.log.info({ port: cfg.PORT, env: cfg.NODE_ENV }, 'payesh2 api ready');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopWorker();
    await app.close();
    await closePool();
    await stopEmbeddedDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', error: (e as Error).message }));
  process.exit(1);
});
