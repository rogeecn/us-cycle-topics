import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "./env.js";

let cachedDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (cachedDb) {
    return cachedDb;
  }

  const env = getEnv();
  const dbPath = path.resolve(process.cwd(), env.SQLITE_DB_PATH);
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  cachedDb = new Database(dbPath);
  cachedDb.pragma("journal_mode = WAL");
  cachedDb.pragma("foreign_keys = ON");
  cachedDb.pragma("busy_timeout = 5000");

  return cachedDb;
}

export function resetDbForTests(): void {
  if (!cachedDb) {
    return;
  }

  cachedDb.close();
  cachedDb = null;
}

export function withTransaction<T>(handler: (db: Database.Database) => T): T {
  const db = getDb();
  const transaction = db.transaction(() => handler(db));
  return transaction();
}
