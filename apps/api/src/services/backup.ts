import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { globalQuery, getPool, migrate } from '../db.js';

const EXCLUDED = new Set(['schema_migrations']);

export type BackupManifest = {
  createdAt: string;
  format: 'payesh-backup/1';
  tables: { name: string; rows: number; sha256: string; file: string }[];
  migrations: string[];
};

function encodeValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return { __type: 'buffer', base64: v.toString('base64') };
  return v;
}

function decodeValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v) && (v as { __type?: string }).__type === 'buffer') {
    return Buffer.from((v as { base64: string }).base64, 'base64');
  }
  return v;
}

export async function listTables(): Promise<string[]> {
  const rows = await globalQuery<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDED.has(t));
}

async function foreignKeyGraph(): Promise<Map<string, string[]>> {
  const rows = await globalQuery<{ child: string; parent: string }>(
    `select tc.table_name as child, ccu.table_name as parent
       from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
  const graph = new Map<string, string[]>();
  for (const r of rows) {
    if (r.child === r.parent) continue;
    const list = graph.get(r.child) ?? [];
    if (!list.includes(r.parent)) list.push(r.parent);
    graph.set(r.child, list);
  }
  return graph;
}

/** ترتیب درج: والد قبل از فرزند (مرتب‌سازی توپولوژیک ساده) */
export async function insertionOrder(): Promise<string[]> {
  const tables = await listTables();
  const graph = await foreignKeyGraph();
  const out: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (t: string) => {
    if (visited.has(t) || visiting.has(t)) return;
    visiting.add(t);
    for (const p of graph.get(t) ?? []) visit(p);
    visiting.delete(t);
    visited.add(t);
    out.push(t);
  };
  for (const t of tables) visit(t);
  return out;
}

export async function createBackup(outDir: string): Promise<BackupManifest> {
  const dir = path.resolve(outDir);
  await mkdir(path.join(dir, 'data'), { recursive: true });
  const tables = await insertionOrder();
  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    format: 'payesh-backup/1',
    tables: [],
    migrations: (await globalQuery<{ version: string }>('select version from schema_migrations order by version')).map(
      (r) => r.version,
    ),
  };

  for (const table of tables) {
    const rows = await globalQuery(`select * from ${quoteIdent(table)}`);
    const file = path.join('data', `${table}.jsonl`);
    const stream = createWriteStream(path.join(dir, file), { encoding: 'utf8' });
    const hash = createHash('sha256');
    let count = 0;
    for (const row of rows) {
      const encoded = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, encodeValue(v)]));
      const line = JSON.stringify(encoded) + '\n';
      hash.update(line);
      if (!stream.write(line)) {
        await new Promise<void>((resolve) => stream.once('drain', () => resolve()));
      }
      count++;
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    manifest.tables.push({ name: table, rows: count, sha256: hash.digest('hex'), file });
  }

  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`نام جدول نامعتبر: ${name}`);
  return `"${name}"`;
}

export async function restoreBackup(inDir: string): Promise<{ tables: number; rows: number }> {
  const dir = path.resolve(inDir);
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== 'payesh-backup/1') throw new Error('قالب پشتیبان پشتیبانی نمی‌شود');

  const pool = getPool();
  const client = await pool.connect();
  let totalRows = 0;
  try {
    const allTables = manifest.tables.map((t) => quoteIdent(t.name)).join(', ');
    await client.query('begin');
    await client.query(`truncate table ${allTables} restart identity cascade`);

    for (const table of manifest.tables) {
      const content = await readFile(path.join(dir, table.file), 'utf8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length !== table.rows) {
        throw new Error(`تعداد ردیف‌های ${table.name} با manifest سازگار نیست`);
      }
      const digest = createHash('sha256');
      for (const line of lines) digest.update(line + '\n');
      if (digest.digest('hex') !== table.sha256) {
        throw new Error(`checksum فایل ${table.name} معتبر نیست`);
      }
      for (const line of lines) {
        const row = JSON.parse(line) as Record<string, unknown>;
        const cols = Object.keys(row);
        const values = cols.map((c) => {
          const v = decodeValue(row[c]);
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
          return v;
        });
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `insert into ${quoteIdent(table.name)} (${cols.map(quoteIdent).join(', ')}) values (${placeholders})`,
          values,
        );
        totalRows++;
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  await resetSequences();
  return { tables: manifest.tables.length, rows: totalRows };
}

/** پس از restore، توالی‌ها باید از حداکثر مقدار موجود ادامه دهند. */
export async function resetSequences(): Promise<void> {
  const rows = await globalQuery<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_default like 'nextval%'`,
  );
  for (const r of rows) {
    const maxRow = await globalQuery<{ m: string }>(
      `select coalesce(max(${quoteIdent(r.column_name)}), 0)::bigint as m from ${quoteIdent(r.table_name)}`,
    );
    const max = Number(maxRow[0]?.m ?? 0);
    await globalQuery('select setval(pg_get_serial_sequence($1,$2), $3, $4)', [
      `public.${r.table_name}`,
      r.column_name,
      max > 0 ? max : 1,
      max > 0,
    ]);
  }
}

/** برای محیط تازه: اسکیمای خالی را با migrationها می‌سازد و سپس داده را بازمی‌گرداند. */
export async function restoreIntoEmptyDatabase(inDir: string): Promise<{ tables: number; rows: number; migrations: number }> {
  const applied = await migrate();
  const restored = await restoreBackup(inDir);
  return { ...restored, migrations: applied.length };
}
