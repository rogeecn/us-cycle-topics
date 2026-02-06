import { normalizeError } from "../../common/src/errors.js";
import { logger } from "../../common/src/logger.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  actionName: string,
  attempts: number,
  initialBackoffMs: number,
  handler: () => Promise<T>,
): Promise<T> {
  let currentAttempt = 1;
  let lastError: unknown;

  while (currentAttempt <= attempts) {
    try {
      return await handler();
    } catch (error) {
      lastError = error;
      if (currentAttempt >= attempts) {
        break;
      }
      const sleepMs = initialBackoffMs * Math.pow(2, currentAttempt - 1);
      logger.warn("retrying action", {
        actionName,
        attempt: currentAttempt,
        sleepMs,
        error: normalizeError(error),
      });
      await wait(sleepMs);
      currentAttempt += 1;
    }
  }

  throw new Error(
    `action ${actionName} failed after ${attempts} attempts: ${normalizeError(lastError)}`,
  );
}
