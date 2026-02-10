import { randomUUID } from "node:crypto";
import cron from "node-cron";
import { z } from "genkit";
import { runMigration } from "../../../db/migrate.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import {
  acquirePipelineLock,
  releasePipelineLock,
} from "../../common/src/repository.js";
import { ai } from "../../producer/src/genkit.js";
import { produceArticle } from "../../producer/src/producer.js";
import { AutoInputSchema } from "../../producer/src/schema.js";
import { emitDailySummary, sendCriticalAlert } from "./alerts.js";
import { runPreflight } from "./preflight.js";

const SCHEDULER_PRODUCER_LOCK_KEY = 424242;

type ProducerTrigger = "startup" | "cron";

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

async function resolveScheduledInput(language: string): Promise<z.infer<typeof AutoInputSchema>> {
  const env = getEnv();
  const autoPrompt = ai.prompt<z.ZodTypeAny, typeof AutoInputSchema, z.ZodTypeAny>(
    env.PRODUCER_AUTO_INPUT_PROMPT_NAME,
  );

  const { output } = await autoPrompt(
    {
      language,
      nowIso: new Date().toISOString(),
      regionHint: "US",
    },
    {
      output: {
        schema: AutoInputSchema,
      },
    },
  );

  if (!output) {
    throw new Error("Genkit returned empty auto-input output");
  }

  return AutoInputSchema.parse(output);
}

async function runScheduledProducer(trigger: ProducerTrigger): Promise<void> {
  const env = getEnv();
  const runId = randomUUID();
  const startedAt = Date.now();

  const locked = await acquirePipelineLock(null, SCHEDULER_PRODUCER_LOCK_KEY);
  if (!locked) {
    logger.warn("scheduler producer lock is already held, skip run", {
      runId,
      trigger,
    });
    return;
  }

  try {
    if (env.PREFLIGHT_ON_RUN) {
      await runMigration();
      await runPreflight();
    }

    logger.info("scheduler producer run started", {
      runId,
      trigger,
    });

    const language = "en";
    const autoInput = await resolveScheduledInput(language);

    logger.info("scheduler producer input resolved", {
      runId,
      trigger,
      topic: autoInput.topic,
      city: autoInput.city,
      keyword: autoInput.keyword,
      source: "ai-generated",
    });

    await produceArticle({
      topic: autoInput.topic,
      city: autoInput.city,
      keyword: autoInput.keyword,
      language,
    });

    logger.info("scheduler producer run finished", {
      runId,
      trigger,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    logger.error("scheduler producer run failed", {
      runId,
      trigger,
      message,
      durationMs: Date.now() - startedAt,
    });

    await sendCriticalAlert(env.ALERT_WEBHOOK_URL, "scheduler producer run failed", {
      runId,
      trigger,
      message,
    });
  } finally {
    await releasePipelineLock(null, SCHEDULER_PRODUCER_LOCK_KEY);
  }
}

async function main(): Promise<void> {
  const env = getEnv();

  await runMigration();

  logger.info("scheduler started", {
    cron: env.SCHEDULER_CRON,
    timezone: env.ALERT_TIMEZONE,
    mode: "producer",
  });

  cron.schedule(
    env.SCHEDULER_CRON,
    async () => {
      await runScheduledProducer("cron");
    },
    { timezone: env.ALERT_TIMEZONE },
  );

  scheduleDailySummary(env);

  await runScheduledProducer("startup");
}

main().catch((error) => {
  logger.error("scheduler daemon crashed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
