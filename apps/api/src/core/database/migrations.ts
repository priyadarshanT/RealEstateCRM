// Applies numbered SQL migrations from db/migrations (NNNN_name.sql) in order.
// Runs as the database owner, each file in its own transaction.
// A database already built with db/setup_db.* adopts 0001_baseline without re-running it.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = resolve(__dirname, '../../../../../db/migrations');
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export async function runMigrations(connectionString: string, log: (line: string) => void = () => undefined): Promise<number> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const files = readdirSync(MIGRATIONS_DIR).filter((f) => FILE_PATTERN.test(f)).sort();
    const applied = new Map<string, string>(
      (await client.query('SELECT version, checksum FROM schema_migrations')).rows.map((r) => [r.version, r.checksum]),
    );

    if (applied.size === 0) {
      const built = await client.query(`SELECT to_regclass('public.tenants') IS NOT NULL AS ok`);
      const baseline = files.find((f) => f.startsWith('0001_'));
      if (built.rows[0].ok && baseline) {
        await record(client, baseline);
        applied.set('0001', checksum(baseline));
        log(`adopted ${baseline} (database already built by db/setup_db)`);
      }
    }

    let count = 0;
    for (const file of files) {
      const version = file.slice(0, 4);
      const known = applied.get(version);
      if (known) {
        if (known !== checksum(file)) throw new Error(`${file} changed after it was applied; add a new migration instead`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await record(client, file);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file} failed: ${(err as Error).message}`);
      }
      log(`applied ${file}`);
      count++;
    }
    return count;
  } finally {
    await client.end();
  }
}

function checksum(file: string): string {
  return createHash('sha256').update(readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/\r/g, '')).digest('hex');
}

async function record(client: Client, file: string): Promise<void> {
  await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
    file.slice(0, 4),
    file.slice(5, -4),
    checksum(file),
  ]);
}
