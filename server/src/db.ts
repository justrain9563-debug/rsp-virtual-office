// Database adapter: real PostgreSQL when DATABASE_URL is set, otherwise
// embedded PGlite (Postgres compiled to WASM) stored in DATA_DIR. Same SQL either way.
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env';

export interface DB {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
  kind: 'postgres' | 'pglite';
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  dept TEXT NOT NULL DEFAULT 'sales',
  role TEXT NOT NULL DEFAULT 'member',
  banned BOOLEAN NOT NULL DEFAULT false,
  avatar JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  desk_id TEXT UNIQUE,
  onboarded BOOLEAN NOT NULL DEFAULT false,
  last_x REAL,
  last_y REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages(channel, id DESC);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  locked BOOLEAN NOT NULL DEFAULT false,
  locked_by TEXT,
  anyone_can_lock BOOLEAN NOT NULL DEFAULT true,
  capacity INT NOT NULL DEFAULT 12
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`;

export let db: DB;

export async function initDb() {
  if (env.databaseUrl) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({
      connectionString: env.databaseUrl,
      ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(env.databaseUrl) ? undefined : { rejectUnauthorized: false },
    });
    db = {
      kind: 'postgres',
      query: (sql, params) => pool.query(sql, params as any[]) as any,
      exec: async (sql) => { await pool.query(sql); },
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = path.join(env.dataDir, 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    const lite = new PGlite(dir);
    await lite.waitReady;
    db = {
      kind: 'pglite',
      query: (sql, params) => lite.query(sql, params as any[]) as any,
      exec: async (sql) => { await lite.exec(sql); },
    };
  }
  await db.exec(SCHEMA);
  console.log(`[db] using ${db.kind}`);
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db.query<{ value: T }>('SELECT value FROM settings WHERE key=$1', [key]);
  return r.rows[0]?.value ?? fallback;
}
export async function setSetting(key: string, value: unknown) {
  await db.query(
    'INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
    [key, JSON.stringify(value)],
  );
}
