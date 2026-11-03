import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { migrations } from "./migrations";

type DB = Database.Database;

const globalForDb = globalThis as unknown as { __misogiDb?: DB };

export function dataDir(): string {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function open(): DB {
  const file = process.env.DATABASE_PATH || path.join(dataDir(), "misogi.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: DB) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < migrations.length; i++) {
    const apply = db.transaction(() => {
      db.exec(migrations[i]);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        i + 1,
        new Date().toISOString(),
      );
    });
    apply();
  }
}

export function db(): DB {
  if (!globalForDb.__misogiDb) globalForDb.__misogiDb = open();
  return globalForDb.__misogiDb;
}

/** Run `fn` inside a transaction (re-entrant: nested calls join the outer one). */
export function tx<T>(fn: () => T): T {
  const d = db();
  if (d.inTransaction) return fn();
  return d.transaction(fn)();
}

export function one<T>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...params);
}
