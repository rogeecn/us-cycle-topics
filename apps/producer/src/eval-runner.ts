import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "genkit";
import { logger } from "../../common/src/logger.js";
import { produceArticle } from "./producer.js";

const EvalInputSchema = z.object({
  input: z.object({
    topic: z.string().min(1),
    city: z.string().min(1),
    keyword: z.string().min(1),
    language: z.string().optional(),
  }),
});

const EvalDatasetSchema = z.array(EvalInputSchema).min(1);

function getDatasetPath(): string {
  const arg = process.argv.find((item) => item.startsWith("--dataset="));
  if (arg) {
    return path.resolve(process.cwd(), arg.split("=")[1]);
  }
  return path.resolve(process.cwd(), "scripts/eval-dataset.json");
}

async function main(): Promise<void> {
  const datasetPath = getDatasetPath();
  const raw = await readFile(datasetPath, "utf8");
  const dataset = EvalDatasetSchema.parse(JSON.parse(raw));

  for (const [index, item] of dataset.entries()) {
    const request = item.input;
    logger.info("eval runner item start", {
      index: index + 1,
      topic: request.topic,
      city: request.city,
      keyword: request.keyword,
    });

    await produceArticle(request);

    logger.info("eval runner item done", {
      index: index + 1,
      topic: request.topic,
      city: request.city,
    });
  }

  logger.info("eval runner completed", {
    datasetPath,
    total: dataset.length,
  });
}

main().catch((error) => {
  logger.error("eval runner failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
