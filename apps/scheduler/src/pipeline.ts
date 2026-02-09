import { randomUUID } from "node:crypto";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import {
  acquirePipelineLock,
  countNeedsReview,
  finishPipelineRun,
  listPublishEligibleBuiltIds,
  markPublished,
  releasePipelineLock,
  startPipelineRun,
} from "../../common/src/repository.js";
import { PipelineRunRecord, RenderMode } from "../../common/src/types.js";
import { renderFromDb } from "../../renderer/src/renderer.js";
import { sendCriticalAlert, sendNeedsReviewAlert } from "./alerts.js";
import { withRetry } from "./retry.js";
import { publishWithRsync } from "./publish.js";
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
    renderedCount: 0,
    buildCount: 0,
    publishEligibleCount: 0,
    blockedByQuality: 0,
    needsReviewCount: 0,
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
      await runPreflight();
    }

    const renderResult = await withRetry(
      "renderFromDb",
      env.RETRY_MAX_ATTEMPTS,
      env.RETRY_BACKOFF_MS,
      () => renderFromDb(mode),
    );

    const publishEligibleIds = await listPublishEligibleBuiltIds(
      env.QUALITY_MIN_SCORE,
      renderResult.renderedIds,
    );

    const publishResult = await publishWithRsync();
    if (!publishResult.success) {
      throw new Error(`publish failed: ${publishResult.stderr || publishResult.stdout}`);
    }

    const shouldMarkPublished =
      env.PUBLISH_METHOD === "rsync" && !env.RSYNC_DRY_RUN && publishEligibleIds.length > 0;
    if (shouldMarkPublished) {
      await markPublished(publishEligibleIds);
    }

    const blockedByQuality = Math.max(0, renderResult.renderedIds.length - publishEligibleIds.length);
    const needsReviewCount = await countNeedsReview();

    stats.renderedCount = renderResult.renderedIds.length;
    stats.buildCount = renderResult.renderedIds.length > 0 ? 1 : 0;
    stats.publishEligibleCount = publishEligibleIds.length;
    stats.blockedByQuality = blockedByQuality;
    stats.needsReviewCount = needsReviewCount;
    stats.publishedCount = shouldMarkPublished ? publishEligibleIds.length : 0;
    stats.failedCount = 0;
    stats.status = "success";
    stats.errorMessage = null;
    stats.endedAt = new Date();

    if (needsReviewCount >= env.NEEDS_REVIEW_ALERT_THRESHOLD) {
      await sendNeedsReviewAlert(
        env.ALERT_WEBHOOK_URL,
        needsReviewCount,
        env.NEEDS_REVIEW_ALERT_THRESHOLD,
      );
    }

    logger.info("pipeline finished", {
      runId,
      mode,
      renderedCount: stats.renderedCount,
      written: renderResult.writtenFiles.length,
      skipped: renderResult.skippedFiles.length,
      publishMethod: env.PUBLISH_METHOD,
      qualityMinScore: env.QUALITY_MIN_SCORE,
      publishEligibleCount: publishEligibleIds.length,
      blockedByQuality,
      needsReviewCount,
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
