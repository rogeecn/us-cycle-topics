import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { getEnv } from "../apps/common/src/env.js";
import { logger } from "../apps/common/src/logger.js";

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function migrationApplied(pool: Pool, version: string): Promise<boolean> {
  const result = await pool.query<{ version: string }>(
    "SELECT version FROM schema_migrations WHERE version = $1",
    [version],
  );
  return (result.rowCount ?? 0) > 0;
}

async function listMigrationFiles(): Promise<string[]> {
  const migrationDir = path.resolve(process.cwd(), "db/migrations");
  const entries = await readdir(migrationDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

async function applySingleMigration(pool: Pool, fileName: string): Promise<void> {
  const version = fileName.replace(/\.sql$/, "");

  if (await migrationApplied(pool, version)) {
    logger.info("migration already applied", { version });
    return;
  }

  const sqlPath = path.resolve(process.cwd(), "db/migrations", fileName);
  const sql = await readFile(sqlPath, "utf8");

  await pool.query(sql);
  await pool.query(
    "INSERT INTO schema_migrations(version, applied_at) VALUES ($1, NOW())",
    [version],
  );

  logger.info("migration applied", { version });
}

export async function runMigration(): Promise<void> {
  const env = getEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL });

  try {
    await ensureMigrationsTable(pool);
    const migrationFiles = await listMigrationFiles();

    await pool.query("BEGIN");
    for (const fileName of migrationFiles) {
      await applySingleMigration(pool, fileName);
    }
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
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
