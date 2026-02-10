import { randomUUID } from "node:crypto";
import { runMigration } from "../../../db/migrate.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import {
  acquirePipelineLock,
  finishPipelineRun,
  listReadyForPublication,
  markPublished,
  releasePipelineLock,
  startPipelineRun,
} from "../../common/src/repository.js";
import { PipelineRunRecord, RenderMode } from "../../common/src/types.js";
import { sendCriticalAlert } from "./alerts.js";
import { runPreflight } from "./preflight.js";

const LOCK_KEY = 424242;

export async function runPipeline(mode: RenderMode): Promise<void> {
  const env = getEnv();
  const runId = randomUUID();
  const startedAt = new Date();

  const stats: PipelineRunRecord = {
    runId,
    mode,
    status: "success",
    publishedCount: 0,
    failedCount: 0,
    errorMessage: null,
    startedAt,
    endedAt: startedAt,
  };

  try {
    const locked = await acquirePipelineLock(null, LOCK_KEY);
    if (!locked) {
      logger.warn("pipeline lock is already held, skip run", { mode });
      return;
    }

    await startPipelineRun(runId, mode);
    logger.info("pipeline started", { runId, mode });

    if (env.PREFLIGHT_ON_RUN) {
      await runMigration();
      await runPreflight();
    }

    const ready = await listReadyForPublication(mode, env.QUALITY_MIN_SCORE, env.RENDER_BATCH_SIZE);
    const publishIds = ready.map((item) => item.id);

    if (publishIds.length > 0) {
      await markPublished(publishIds);
    }

    stats.publishedCount = publishIds.length;
    stats.failedCount = 0;
    stats.status = "success";
    stats.errorMessage = null;
    stats.endedAt = new Date();

    logger.info("pipeline finished", {
      runId,
      mode,
      publishedCount: publishIds.length,
      qualityMinScore: env.QUALITY_MIN_SCORE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stats.status = "failed";
    stats.errorMessage = message;
    stats.failedCount += 1;
    stats.endedAt = new Date();

    logger.error("pipeline failed", { runId, mode, message });

    await sendCriticalAlert(env.ALERT_WEBHOOK_URL, "pipeline failed", {
      runId,
      mode,
      message,
    });
  } finally {
    await finishPipelineRun(stats);
    await releasePipelineLock(null, LOCK_KEY);
  }
}
