import { getEnv } from "../apps/common/src/env.js";
import { logger } from "../apps/common/src/logger.js";
import { withRetry } from "../apps/scheduler/src/retry.js";
import { runPreflight } from "../apps/scheduler/src/preflight.js";
import { runMigration } from "./migrate.js";

async function main(): Promise<void> {
  const env = getEnv();

  await withRetry(
    "pg-bootstrap",
    env.PG_BOOTSTRAP_MAX_ATTEMPTS,
    env.PG_BOOTSTRAP_BACKOFF_MS,
    async () => {
      await runPreflight();
      await runMigration();
    },
  );

  logger.info("bootstrap completed");
}

main().catch((error) => {
  logger.error("bootstrap failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
