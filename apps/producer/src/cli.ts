import { z } from "genkit";
import { ai } from "./genkit.js";
import { AutoInputSchema } from "./schema.js";
import { produceArticle } from "./producer.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";

function getArg(name: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function resolveInput(): Promise<{
  topic: string;
  city: string;
  keyword: string;
  language?: string;
  source: "manual" | "ai-generated";
}> {
  const env = getEnv();

  const topicArg = getArg("topic");
  const cityArg = getArg("city");
  const keywordArg = getArg("keyword");
  const language = getArg("language");

  if (topicArg && cityArg && keywordArg) {
    return {
      topic: topicArg,
      city: cityArg,
      keyword: keywordArg,
      language,
      source: "manual",
    };
  }

  const autoPrompt = ai.prompt<z.ZodTypeAny, typeof AutoInputSchema, z.ZodTypeAny>(
    env.PRODUCER_AUTO_INPUT_PROMPT_NAME,
  );

  const { output } = await autoPrompt(
    {
      language: language ?? "en",
      nowIso: new Date().toISOString(),
      regionHint: "US",
    },
    {
      output: {
        schema: AutoInputSchema,
      },
    },
  );

  if (!output) {
    throw new Error("Genkit returned empty auto-input output");
  }

  const auto = AutoInputSchema.parse(output);

  return {
    topic: topicArg ?? auto.topic,
    city: cityArg ?? auto.city,
    keyword: keywordArg ?? auto.keyword,
    language,
    source: "ai-generated",
  };
}

async function main(): Promise<void> {
  const resolved = await resolveInput();

  logger.info("producer input resolved", {
    topic: resolved.topic,
    city: resolved.city,
    keyword: resolved.keyword,
    source: resolved.source,
  });

  await produceArticle({
    topic: resolved.topic,
    city: resolved.city,
    keyword: resolved.keyword,
    language: resolved.language,
  });
}

main().catch((error) => {
  logger.error("producer failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
