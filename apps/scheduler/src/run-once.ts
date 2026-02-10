import { runMigration } from "../../../db/migrate.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import { produceArticle } from "../../producer/src/producer.js";
import { emitDailySummary } from "./alerts.js";
import { runPreflight } from "./preflight.js";

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function shouldDailySummary(): boolean {
  return process.argv.includes("--daily-summary");
}

async function main(): Promise<void> {
  const env = getEnv();
  await runMigration();

  if (env.PREFLIGHT_ON_RUN) {
    await runPreflight();
  }

  const topic = getArg("topic");
  const city = getArg("city");
  const keyword = getArg("keyword");
  const language = getArg("language") ?? "en";

  if (!topic || !city || !keyword) {
    throw new Error("run-once requires --topic --city --keyword");
  }

  logger.info("scheduler run-once producer started", {
    topic,
    city,
    keyword,
    language,
  });

  await produceArticle({
    topic,
    city,
    keyword,
    language,
  });

  logger.info("scheduler run-once producer finished", {
    topic,
    city,
    keyword,
  });

  if (shouldDailySummary()) {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    await emitDailySummary(env.ALERT_WEBHOOK_URL, dayStart);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
