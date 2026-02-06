import { renderFromDb } from "./renderer.js";
import { logger } from "../../common/src/logger.js";

function parseMode(): "incremental" | "full" {
  const modeArg = process.argv.find((arg) => arg.startsWith("--mode="));
  if (!modeArg) {
    return "incremental";
  }
  const mode = modeArg.split("=")[1];
  if (mode === "full") {
    return "full";
  }
  return "incremental";
}

async function main(): Promise<void> {
  const mode = parseMode();
  const result = await renderFromDb(mode);
  logger.info("renderer run completed", {
    mode,
    rendered: result.renderedIds.length,
    written: result.writtenFiles.length,
    skipped: result.skippedFiles.length,
  });
}

main().catch((error) => {
  logger.error("renderer run failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
