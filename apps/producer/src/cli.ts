import { produceArticle } from "./producer.js";
import { logger } from "../../common/src/logger.js";

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const topic = getArg("topic");
  const city = getArg("city");
  const keyword = getArg("keyword");
  const language = getArg("language");

  if (!topic || !city || !keyword) {
    throw new Error("missing required args: --topic --city --keyword");
  }

  await produceArticle({ topic, city, keyword, language });
}

main().catch((error) => {
  logger.error("producer failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
