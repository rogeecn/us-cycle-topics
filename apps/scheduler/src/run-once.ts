import { runPipeline } from "./pipeline.js";
import { emitDailySummary } from "./alerts.js";
import { getEnv } from "../../common/src/env.js";

function parseMode(): "incremental" | "full" {
  const flag = process.argv.find((arg) => arg.startsWith("--mode="));
  if (!flag) {
    return "incremental";
  }

  const value = flag.split("=")[1];
  return value === "full" ? "full" : "incremental";
}

function shouldDailySummary(): boolean {
  return process.argv.includes("--daily-summary");
}

async function main(): Promise<void> {
  const mode = parseMode();
  await runPipeline(mode);

  if (shouldDailySummary()) {
    const env = getEnv();
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
