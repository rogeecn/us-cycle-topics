import { createHash } from "node:crypto";
import { logger } from "../../common/src/logger.js";
import {
  appendAlertLog,
  hasAlertKey,
  listFailedSince,
} from "../../common/src/repository.js";

function makeKey(prefix: string, payload: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

async function postWebhook(url: string, payload: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`webhook responded ${response.status}`);
  }
}

export async function sendCriticalAlert(
  webhookUrl: string | undefined,
  message: string,
  payload: unknown,
): Promise<void> {
  const alertPayload = { level: "critical", message, payload };
  const alertKey = makeKey("critical", alertPayload);

  if (await hasAlertKey(alertKey)) {
    logger.info("critical alert deduplicated", { alertKey });
    return;
  }

  if (webhookUrl) {
    await postWebhook(webhookUrl, alertPayload);
  }

  await appendAlertLog("critical", alertKey, alertPayload);
  logger.error("critical alert emitted", { message, payload });
}

export async function emitDailySummary(
  webhookUrl: string | undefined,
  windowStart: Date,
): Promise<void> {
  const failed = await listFailedSince(windowStart);
  const payload = {
    level: "daily",
    windowStart: windowStart.toISOString(),
    failedCount: failed.length,
    failedIds: failed.map((item) => item.id),
  };
  const alertKey = makeKey(
    `daily-${windowStart.toISOString().slice(0, 10)}`,
    payload,
  );

  if (await hasAlertKey(alertKey)) {
    return;
  }

  if (webhookUrl) {
    await postWebhook(webhookUrl, payload);
  }

  await appendAlertLog("daily", alertKey, payload);
  logger.info("daily alert emitted", payload);
}
