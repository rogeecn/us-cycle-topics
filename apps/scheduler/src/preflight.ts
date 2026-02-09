import { access, constants } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getDb } from "../../common/src/db.js";
import { getEnv } from "../../common/src/env.js";
import { normalizeError } from "../../common/src/errors.js";
import { logger } from "../../common/src/logger.js";
import { withRetry } from "./retry.js";
import { scaffoldHugoSite } from "../../renderer/src/scaffold.js";

const REQUIRED_TABLES = [
  "schema_migrations",
  "seo_articles",
  "pipeline_runs",
  "alert_logs",
  "pipeline_locks",
  "producer_trigger_requests",
];

export interface PreflightReport {
  database: "ok" | "failed";
  hugo: "ok" | "failed";
  rsync: "ok" | "skipped" | "failed";
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

async function checkCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${String(code)}: ${stderr}`));
    });

    child.on("error", (error) => {
      reject(new Error(`${command} failed to start: ${normalizeError(error)}`));
    });
  });
}

async function ensureHugoPaths(): Promise<void> {
  const env = getEnv();
  if (!env.PREFLIGHT_ENSURE_HUGO_SCAFFOLD) {
    return;
  }

  await scaffoldHugoSite();

  await access(env.HUGO_WORKDIR, constants.W_OK);
  await access(env.HUGO_CONTENT_DIR, constants.W_OK);
  await access(env.HUGO_PUBLIC_DIR, constants.W_OK);
}

async function checkHugo(): Promise<void> {
  const env = getEnv();
  await checkCommand(env.HUGO_COMMAND, ["version"]);
  await ensureHugoPaths();
}

async function checkRsync(): Promise<"ok" | "skipped"> {
  const env = getEnv();
  if (env.PUBLISH_METHOD !== "rsync") {
    return "skipped";
  }

  await checkCommand("rsync", ["--version"]);
  return "ok";
}

export async function runPreflight(): Promise<PreflightReport> {
  const env = getEnv();

  const report: PreflightReport = {
    database: "failed",
    hugo: "failed",
    rsync: env.PUBLISH_METHOD === "rsync" ? "failed" : "skipped",
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

  await checkHugo();
  report.hugo = "ok";

  report.rsync = await checkRsync();

  logger.info("preflight checks passed", {
    database: report.database,
    hugo: report.hugo,
    rsync: report.rsync,
  });
  return report;
}
