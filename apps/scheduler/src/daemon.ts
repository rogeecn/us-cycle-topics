import cron from "node-cron";
import { runPipeline } from "./pipeline.js";
import { emitDailySummary } from "./alerts.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";

function scheduleDailySummary(env: ReturnType<typeof getEnv>): void {
  const hour = String(env.ALERT_DAILY_HOUR_LOCAL).padStart(2, "0");
  const expression = `0 ${hour} * * *`;

  cron.schedule(
    expression,
    async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      await emitDailySummary(env.ALERT_WEBHOOK_URL, start);
    },
    { timezone: env.ALERT_TIMEZONE },
  );
}

async function main(): Promise<void> {
  const env = getEnv();

  logger.info("scheduler started", {
    cron: env.SCHEDULER_CRON,
    timezone: env.ALERT_TIMEZONE,
  });

  cron.schedule(
    env.SCHEDULER_CRON,
    async () => {
      await runPipeline("incremental");
    },
    { timezone: env.ALERT_TIMEZONE },
  );

  scheduleDailySummary(env);

  await runPipeline("incremental");
}

main().catch((error) => {
  logger.error("scheduler daemon crashed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
