import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../apps/common/src/db.js";
import { logger } from "../apps/common/src/logger.js";
import Database from "better-sqlite3";

function ensureMigrationsTable(db: Database.Database): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function migrationApplied(db: Database.Database, version: string): boolean {
  const row = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(version);

  return Boolean(row);
}

function listMigrationFiles(): string[] {
  const migrationDir = path.resolve(process.cwd(), "db/migrations");
  const entries = fs.readdirSync(migrationDir, { withFileTypes: true });

  return entries
    .filter((entry: fs.Dirent) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry: fs.Dirent) => entry.name)
    .sort();
}

export async function runMigration(): Promise<void> {
  const db = getDb();
  ensureMigrationsTable(db);

  const migrationFiles = listMigrationFiles();
  const runInTransaction = db.transaction(() => {
    for (const fileName of migrationFiles) {
      const version = fileName.replace(/\.sql$/, "");

      if (migrationApplied(db, version)) {
        logger.info("migration already applied", { version });
        continue;
      }

      const sqlPath = path.resolve(process.cwd(), "db/migrations", fileName);
      const sql = fs.readFileSync(sqlPath, "utf8");

      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, applied_at) VALUES (?, CURRENT_TIMESTAMP)",
      ).run(version);

      logger.info("migration applied", { version });
    }
  });

  runInTransaction();
}

const directRun = process.argv[1] ? path.resolve(process.argv[1]) : "";
const thisFile = fileURLToPath(import.meta.url);

if (directRun === thisFile) {
  runMigration().catch((error) => {
    logger.error("migration failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
