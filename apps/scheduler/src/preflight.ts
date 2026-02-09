import { access, constants } from "node:fs/promises";
import path from "node:path";
import { getDb } from "../../common/src/db.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import { withRetry } from "./retry.js";

const REQUIRED_TABLES = [
  "schema_migrations",
  "seo_articles",
  "pipeline_runs",
  "alert_logs",
  "pipeline_locks",
];

export interface PreflightReport {
  database: "ok" | "failed";
  staticAssets: "ok" | "failed";
}

async function checkDatabase(): Promise<void> {
  const db = getDb();
  const row = db.prepare("SELECT 1 AS ok").get();
  if (!row) {
    throw new Error("database ping failed");
  }

  for (const tableName of REQUIRED_TABLES) {
    const exists = db
      .prepare(
        `SELECT 1 AS ok
         FROM sqlite_master
         WHERE type = 'table'
           AND name = ?
         LIMIT 1`,
      )
      .get(tableName);

    if (!exists) {
      throw new Error(`required table missing: ${tableName}`);
    }
  }
}

async function checkStaticAssets(): Promise<void> {
  const env = getEnv();
  const publicDir = path.resolve(process.cwd(), env.STATIC_PUBLIC_DIR);

  await access(publicDir, constants.R_OK);
  await access(path.join(publicDir, "css", "style.css"), constants.R_OK);
  await access(path.join(publicDir, "js", "menu.js"), constants.R_OK);
}

export async function runPreflight(): Promise<PreflightReport> {
  const env = getEnv();
  const report: PreflightReport = {
    database: "failed",
    staticAssets: "failed",
  };

  await withRetry(
    "preflight:database",
    env.PG_BOOTSTRAP_MAX_ATTEMPTS,
    env.PG_BOOTSTRAP_BACKOFF_MS,
    async () => {
      await checkDatabase();
      report.database = "ok";
    },
  );

  await checkStaticAssets();
  report.staticAssets = "ok";

  logger.info("preflight checks passed", {
    database: report.database,
    staticAssets: report.staticAssets,
  });

  return report;
}
