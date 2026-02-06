import { ai } from "./genkit.js";
import { z } from "genkit";
import { ArticleOutputSchema, type ArticleOutput } from "./schema.js";
import { getEnv } from "../../common/src/env.js";
import { logger } from "../../common/src/logger.js";
import { evaluateQuality } from "../../common/src/quality.js";
import { sha256 } from "../../common/src/hash.js";
import { upsertGeneratedContent } from "../../common/src/repository.js";
import { ProducerRequest } from "../../common/src/types.js";

function buildSourceKey(request: ProducerRequest): string {
  return `${request.city}::${request.topic}::${request.keyword}`.toLowerCase();
}

export async function produceArticle(request: ProducerRequest): Promise<void> {
  const env = getEnv();
  const prompt = ai.prompt<z.ZodTypeAny, typeof ArticleOutputSchema, z.ZodTypeAny>(
    env.PRODUCER_PROMPT_NAME,
  );

  const { output } = await prompt(
    {
      topic: request.topic,
      city: request.city,
      keyword: request.keyword,
      language: request.language ?? "en",
      promptVersion: env.GENKIT_PROMPT_VERSION,
      nowIso: new Date().toISOString(),
    },
    {
      output: {
        schema: ArticleOutputSchema,
      },
    },
  );

  if (!output) {
    throw new Error("Genkit returned empty output");
  }

  const article: ArticleOutput = ArticleOutputSchema.parse(output);
  const qualityReport = evaluateQuality({
    title: article.title,
    description: article.description,
    tags: article.tags,
    content: article.content,
  });

  const contentHash = sha256(`${article.title}\n${article.description}\n${article.content}`);

  const record = await upsertGeneratedContent({
    sourceKey: buildSourceKey(request),
    topic: request.topic,
    city: request.city,
    keyword: request.keyword,
    title: article.title,
    description: article.description,
    slug: article.slug,
    tags: article.tags,
    content: article.content,
    lastmod: new Date(article.lastmod),
    promptVersion: env.GENKIT_PROMPT_VERSION,
    modelVersion: env.GENKIT_MODEL,
    rawJson: output,
    qualityReport,
    contentHash,
  });

  logger.info("producer stored article", {
    id: record.id,
    sourceKey: record.sourceKey,
    slug: record.slug,
    status: record.status,
    qualityPassed: record.qualityReport.passed,
  });
}
