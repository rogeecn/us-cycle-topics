import { normalizeError } from "../../common/src/errors.js";
import { logger } from "../../common/src/logger.js";
import { runPreflight } from "./preflight.js";

async function main(): Promise<void> {
  const report = await runPreflight();
  logger.info("preflight result", {
    database: report.database,
    staticAssets: report.staticAssets,
  });
}

main().catch((error) => {
  logger.error("preflight failed", {
    message: normalizeError(error),
  });
  process.exitCode = 1;
});
